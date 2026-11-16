import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { DIVISION_LABELS, type Division } from "@/lib/constants";
import { BRANCHES, branchLabel } from "@/lib/management";
import {
  ensureCancellationsSeeded,
  listCancellationMonths,
  loadCancellations,
  mbrAttritionFor,
  cancellationBudgetByBranch,
  cancellationBudgetYear,
} from "@/lib/cancellations";
import { GroupedBars } from "@/components/charts";
import {
  BarList,
  DivisionDonut,
  CancelFilters,
  AccountTable,
  UploadCard,
  DIVISION_COLORS,
  type BarRow,
} from "./CancelCharts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cancellation Center — CanopyOS" };

// Cancellation Center (COO request 2026-11-16). Upload the PestPac Gain & Loss
// Report (one month, sorted by Branch, Route) and break cancellations out by
// branch, service division, service type, route / technician and city, with a
// check against the MBR's cancellations line when that month's MBR exists.
// Branch managers are pinned to their own branch; admins upload. Gated by the
// `cancellations` access item (lib/access-catalog.ts) via the (app) layout.

const DIV_ORDER: Division[] = ["GHP", "LO", "TERMITE", "MOSQUITO", "RODENT", "OTHER"];
const BANDS = [
  { key: "lt300", label: "Under $300", test: (v: number) => v < 300 },
  { key: "300", label: "$300–$599", test: (v: number) => v >= 300 && v < 600 },
  { key: "600", label: "$600–$999", test: (v: number) => v >= 600 && v < 1000 },
  { key: "1000", label: "$1,000 and up", test: (v: number) => v >= 1000 },
];

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};
const mdy = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}/${y}`; };
const lastDayOf = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

type Row = Awaited<ReturnType<typeof loadCancellations>>[number];

function group(rows: Row[], keyOf: (r: Row) => string) {
  const m = new Map<string, { value: number; count: number; rows: Row[] }>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = m.get(k) ?? { value: 0, count: 0, rows: [] };
    g.value += r.lossValue; g.count += r.lossCount; g.rows.push(r);
    m.set(k, g);
  }
  return m;
}

export default async function CancellationCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await ensureCancellationsSeeded();

  const isAdmin = user.role === "admin";
  const locked = branchLocked(user) ? user.branch : null;
  const months = await listCancellationMonths();

  if (months.length === 0) {
    return (
      <>
        <PageHeader title="Cancellation Center" subtitle="Cancellations by branch, division, service, route and city" />
        <EmptyState title="No cancellation reports yet" hint={isAdmin ? "Upload the PestPac Gain & Loss Report below to get started." : "An admin uploads the monthly PestPac Gain & Loss Report here."} />
        {isAdmin ? <Card className="mt-4"><UploadCard /></Card> : null}
      </>
    );
  }

  const month = months.find((m) => m.periodKey === sp.m) ?? months[0];
  const branch = scopedBranch(user, BRANCHES.some((b) => b.key === sp.branch) ? sp.branch! : null);
  const all = await loadCancellations([month.periodKey], branch);
  const f = { div: sp.div ?? "", svc: sp.svc ?? "", route: sp.route ?? "", city: sp.city ?? "" };

  // Cross-filtering: each breakdown applies every filter except its own, and
  // highlights the active value; the totals + table apply all of them.
  const apply = (rows: Row[], skip?: keyof typeof f) =>
    rows.filter((r) =>
      (skip === "div" || !f.div || r.division === f.div) &&
      (skip === "svc" || !f.svc || r.serviceCode === f.svc) &&
      (skip === "route" || !f.route || r.route === f.route) &&
      (skip === "city" || !f.city || r.city === f.city));
  const rows = apply(all);

  const href = (k: string, v: string) => {
    const q = new URLSearchParams();
    for (const [key, val] of Object.entries(sp)) if (val && key !== "denied") q.set(key, val);
    if (q.get(k) === v) q.delete(k); else q.set(k, v);
    if (k === "branch") { q.delete("route"); q.delete("city"); }
    return `?${q.toString()}`;
  };

  const totalValue = rows.reduce((s, r) => s + r.lossValue, 0);
  const totalCount = rows.reduce((s, r) => s + r.lossCount, 0);
  const accounts = new Set(rows.map((r) => r.account)).size;
  const avg = totalCount > 0 ? totalValue / totalCount : 0;
  const isMtd = Number(month.endDate.slice(8, 10)) < lastDayOf(month.periodKey);

  // Route → technician label (route holder at import time).
  const techOf = new Map<string, string>();
  for (const r of all) if (r.techName && !techOf.has(`${r.branch}|${r.route}`)) techOf.set(`${r.branch}|${r.route}`, r.techName);
  const routeLabel = (r: { branch: string; route: string }) => techOf.get(`${r.branch}|${r.route}`) ?? "";

  // --- Budget vs actual (branch-level targets; ignores non-branch filters) ---
  const budgets = await cancellationBudgetByBranch(month.periodKey);
  const daysInMonth = lastDayOf(month.periodKey);
  const throughDay = Number(month.endDate.slice(8, 10));
  const frac = Math.min(1, throughDay / daysInMonth);
  const budgetAll = branch ? all : await loadCancellations([month.periodKey], null);
  const budgetRows = (branch ? BRANCHES.filter((b) => b.key === branch) : BRANCHES).map((b) => {
    const actual = budgetAll.filter((r) => r.branch === b.key).reduce((s, r) => s + r.lossValue, 0);
    const budget = budgets.get(b.key) ?? null;
    return { key: b.key as string, label: b.label as string, budget, toDate: budget != null ? budget * frac : null, actual };
  });
  if (!branch && budgetRows.length > 1) {
    const budget = budgetRows.every((r) => r.budget != null) ? budgetRows.reduce((s, r) => s + (r.budget ?? 0), 0) : null;
    budgetRows.push({ key: "company", label: "Company", budget, toDate: budget != null ? budget * frac : null, actual: budgetRows.reduce((s, r) => s + r.actual, 0) });
  }
  const scopeBudget = budgetRows[budgetRows.length - 1];
  const nonBranchFilter = !!(f.div || f.svc || f.route || f.city);
  const year = Number(month.periodKey.slice(0, 4));
  const yearPoints = (await cancellationBudgetYear(branch ?? "company", year)).filter((p) => p.actual != null && p.m <= Number(month.periodKey.slice(5, 7)));

  // --- Breakdowns ---------------------------------------------------------
  const branchRows: BarRow[] = locked ? [] : [...group(apply(all), (r) => r.branch)]
    .map(([k, g]) => ({ key: k, label: branchLabel(k), value: g.value, count: g.count, href: href("branch", k), active: branch === k }))
    .sort((a, b) => b.value - a.value);
  // Branch breakdown needs the un-branch-filtered set to stay comparable.
  let branchCompare: BarRow[] = branchRows;
  if (!locked && branch) {
    const every = apply(await loadCancellations([month.periodKey], null));
    branchCompare = [...group(every, (r) => r.branch)]
      .map(([k, g]) => ({ key: k, label: branchLabel(k), value: g.value, count: g.count, href: href("branch", k), active: branch === k }))
      .sort((a, b) => b.value - a.value);
  }
  const branchTotal = branchCompare.reduce((s, r) => s + r.value, 0);

  const divGroups = group(apply(all, "div"), (r) => r.division);
  const divSlices = DIV_ORDER.filter((d) => divGroups.has(d)).map((d) => ({
    key: d, label: DIVISION_LABELS[d], value: divGroups.get(d)!.value, count: divGroups.get(d)!.count, href: href("div", d), active: f.div === d,
  }));

  const svcBase = apply(all, "svc");
  const svcRows: BarRow[] = [...group(svcBase, (r) => r.serviceCode)]
    .map(([k, g]) => ({ key: k, label: k || "(blank)", sub: DIVISION_LABELS[(g.rows[0].division as Division)] ?? "", value: g.value, count: g.count, href: href("svc", k), active: f.svc === k }))
    .sort((a, b) => b.value - a.value);

  const routeBase = apply(all, "route");
  const routeRows: BarRow[] = [...group(routeBase, (r) => `${r.branch}|${r.route}`)]
    .map(([k, g]) => {
      const r0 = g.rows[0];
      const tech = routeLabel(r0);
      return { key: k, label: `Route ${r0.route}`, sub: [tech, branch ? "" : branchLabel(r0.branch)].filter(Boolean).join(" · "), value: g.value, count: g.count, href: href("route", r0.route), active: f.route === r0.route };
    })
    .sort((a, b) => b.value - a.value);

  const cityBase = apply(all, "city");
  const cityRows: BarRow[] = [...group(cityBase, (r) => r.city || "(no city)")]
    .map(([k, g]) => ({ key: k, label: k, value: g.value, count: g.count, href: href("city", k), active: f.city === k }))
    .sort((a, b) => b.value - a.value);

  const bandRows: BarRow[] = BANDS.map((b) => {
    const rs = rows.filter((r) => b.test(r.lossValue));
    return { key: b.key, label: b.label, value: rs.reduce((s, r) => s + r.lossValue, 0), count: rs.reduce((s, r) => s + r.lossCount, 0) };
  });

  // Branch × division matrix (company view only).
  const matrixBranches = locked || branch ? [] : BRANCHES.filter((b) => all.some((r) => r.branch === b.key));
  const matrixDivs = DIV_ORDER.filter((d) => rows.some((r) => r.division === d));
  const cellOf = (b: string, d: string) => rows.filter((r) => r.branch === b && r.division === d).reduce((s, r) => s + r.lossValue, 0);
  const matrixMax = Math.max(1, ...matrixBranches.flatMap((b) => matrixDivs.map((d) => cellOf(b.key, d))));
  const RAMP = ["#eef4f0", "#dce9df", "#c3dac9", "#a3c6ab", "#74a96e", "#4f8a5f", "#2e6f47", "#1f5836"];
  const shade = (v: number) => (v <= 0 ? "#ffffff" : RAMP[Math.min(RAMP.length - 1, Math.floor((v / matrixMax) * (RAMP.length - 1)))]);

  // --- Patterns (facts computed from the rows; no guessing) -----------------
  const patterns: string[] = [];
  if (rows.length) {
    if (!branch && branchCompare[0] && branchTotal > 0) {
      const b = branchCompare[0];
      patterns.push(`${b.label} accounts for ${Math.round((b.value / branchTotal) * 100)}% of lost value (${money0(b.value)}, ${b.count} services).`);
    }
    if (routeRows[0] && routeRows.length > 1) {
      const r = routeRows[0];
      patterns.push(`${r.label}${r.sub ? ` (${r.sub})` : ""} lost the most: ${r.count} services, ${money0(r.value)} — ${Math.round((r.value / Math.max(1, totalValue)) * 100)}% of the total in view.`);
    }
    const repeatRoutes = routeRows.filter((r) => r.count >= 3);
    if (repeatRoutes.length) patterns.push(`${repeatRoutes.length} route${repeatRoutes.length === 1 ? " has" : "s have"} 3 or more cancellations: ${repeatRoutes.slice(0, 5).map((r) => r.label.replace("Route ", "")).join(", ")}${repeatRoutes.length > 5 ? ` and ${repeatRoutes.length - 5} more` : ""}.`);
    const byAcct = group(rows, (r) => r.account);
    const multi = [...byAcct.values()].filter((g) => g.rows.length >= 2);
    if (multi.length) patterns.push(`${multi.length} account${multi.length === 1 ? "" : "s"} cancelled more than one service (${money0(multi.reduce((s, g) => s + g.value, 0))}) — whole-account losses.`);
    const big = rows.filter((r) => r.lossValue >= 1000);
    if (big.length) patterns.push(`${big.length} cancellation${big.length === 1 ? " is" : "s are"} worth $1,000 or more, together ${money0(big.reduce((s, r) => s + r.lossValue, 0))} (${Math.round((big.reduce((s, r) => s + r.lossValue, 0) / Math.max(1, totalValue)) * 100)}% of the total).`);
    if (cityRows[0] && cityRows.length > 1) patterns.push(`${cityRows[0].label} has the most cancellations by city: ${cityRows[0].count} services, ${money0(cityRows[0].value)}.`);
    const other = rows.filter((r) => r.division === "OTHER");
    if (other.length) patterns.push(`${other.length} service code${other.length === 1 ? "" : "s"} couldn't be matched to a division (${[...new Set(other.map((r) => r.serviceCode))].join(", ")}).`);
  }

  // --- MBR check ------------------------------------------------------------
  const mbr = await mbrAttritionFor(month.periodKey);
  const allForMbr = branch ? all : await loadCancellations([month.periodKey], null);
  const mbrRows: { key: string; label: string; report: number; mbr: number | null }[] = (locked ? BRANCHES.filter((b) => b.key === locked) : BRANCHES).map((b) => {
    const report = allForMbr.filter((r) => r.branch === b.key).reduce((s, r) => s + r.lossValue, 0);
    const m = mbr.get(b.key);
    return { key: b.key, label: b.label, report, mbr: m ?? null };
  });
  if (!locked) {
    const report = allForMbr.reduce((s, r) => s + r.lossValue, 0);
    mbrRows.push({ key: "company", label: "Company", report, mbr: mbr.get("company") ?? null });
  }

  // --- Month trend (when 2+ months are loaded) -------------------------------
  let trendRows: BarRow[] = [];
  if (months.length >= 2) {
    const every = await loadCancellations(months.map((m) => m.periodKey), branch);
    const g = group(every, (r) => r.periodKey);
    trendRows = [...months].reverse().map((m) => ({
      key: m.periodKey, label: monthLabel(m.periodKey), sub: Number(m.endDate.slice(8, 10)) < lastDayOf(m.periodKey) ? `through ${mdy(m.endDate)}` : "",
      value: g.get(m.periodKey)?.value ?? 0, count: g.get(m.periodKey)?.count ?? 0,
      href: href("m", m.periodKey), active: m.periodKey === month.periodKey,
    }));
  }

  // --- Filter options ---------------------------------------------------------
  const opts = (vals: [string, string][]) => vals.map(([value, label]) => ({ value, label }));
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const routesForOpts = uniq(all.map((r) => `${r.branch}|${r.route}`)).map((k) => { const [b, rt] = k.split("|"); return { b, rt }; })
    .sort((a, b) => a.rt.localeCompare(b.rt, undefined, { numeric: true }));

  const accountRows = rows.map((r) => ({
    account: r.account, customer: r.customer, city: r.city, zip: r.zip, branch: branchLabel(r.branch), route: r.route, tech: routeLabel(r),
    serviceCode: r.serviceCode, division: DIVISION_LABELS[r.division as Division] ?? r.division, lossCount: r.lossCount, lossValue: r.lossValue,
  }));

  const scopeLabel = branch ? branchLabel(branch) : "All branches";
  const windowLabel = `${mdy(month.startDate)}–${mdy(month.endDate)}${isMtd ? " (month to date)" : ""}`;
  const section = "px-4 py-3 border-b border-line text-sm font-medium text-ink";

  return (
    <>
      <PageHeader
        title="Cancellation Center"
        subtitle={`${monthLabel(month.periodKey)} · ${windowLabel} · ${scopeLabel} · PestPac Gain & Loss Report`}
      />

      <Card className="p-4">
        <CancelFilters
          months={months.map((m) => ({ value: m.periodKey, label: monthLabel(m.periodKey) }))}
          branches={BRANCHES.map((b) => ({ value: b.key, label: b.label }))}
          divisions={DIV_ORDER.filter((d) => all.some((r) => r.division === d)).map((d) => ({ value: d, label: DIVISION_LABELS[d] }))}
          services={opts(uniq(all.map((r) => r.serviceCode)).sort().map((s) => [s, s]))}
          routes={routesForOpts.map(({ b, rt }) => ({ value: rt, label: `${rt}${techOf.get(`${b}|${rt}`) ? ` · ${techOf.get(`${b}|${rt}`)}` : ""}` }))}
          cities={opts(uniq(all.map((r) => r.city).filter(Boolean)).sort().map((c) => [c, c]))}
          lockedBranch={locked}
        />
      </Card>

      {/* KPI tiles */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Lost value", value: money0(totalValue), note: !nonBranchFilter && scopeBudget?.toDate != null ? `budget to date ${money0(scopeBudget.toDate)}` : "Loss Value on the report" },
          { label: "Cancelled services", value: totalCount.toLocaleString("en-US"), note: `${windowLabel.replace(" (month to date)", "")}` },
          { label: "Accounts", value: accounts.toLocaleString("en-US"), note: "distinct locations" },
          { label: "Average per service", value: money0(avg), note: "lost value ÷ services" },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted">{k.label}</div>
            <div className="mt-1 text-2xl font-light tabular-nums text-ink">{k.value}</div>
            <div className="mt-1 text-[11px] text-muted">{k.note}</div>
          </Card>
        ))}
      </div>

      {/* Budget vs actual */}
      <Card className="mt-4">
        <div className={section}>
          Budget vs actual{" "}
          <span className="font-normal text-muted">· 2026 branch cancellation targets (the same targets the quarterly scorecards use){nonBranchFilter ? " · set by branch, so the division / service / route / city filters don't apply here" : ""}</span>
        </div>
        <div className="p-4">
          {budgetRows.some((r) => r.budget != null) ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th scope="col" className="py-1.5 text-left font-medium">Branch</th>
                    <th scope="col" className="py-1.5 text-right font-medium">{monthLabel(month.periodKey).split(" ")[0]} budget</th>
                    <th scope="col" className="py-1.5 text-right font-medium">{isMtd ? `Budget to ${mdy(month.endDate).slice(0, -5)}` : "Budget"}</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Actual</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Variance</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {budgetRows.map((r) => {
                    const v = r.toDate != null ? r.actual - r.toDate : null;
                    const over = v != null && v > 0;
                    return (
                      <tr key={r.key} className={`border-t border-line ${r.key === "company" ? "font-medium" : ""}`}>
                        <td className="py-1.5 text-ink">{r.label}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{r.budget != null ? money0(r.budget) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{r.toDate != null ? money0(r.toDate) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{money0(r.actual)}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{v != null ? `${v >= 0 ? "+" : "−"}${money0(Math.abs(v))}` : "—"}</td>
                        <td className={`py-1.5 text-right ${v == null ? "text-muted" : over ? "text-red-700" : "text-brand-700"}`}>
                          {v == null ? "No budget" : over ? (isMtd ? "Over budget pace" : "Over budget") : (isMtd ? "Within budget pace" : "Within budget")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {isMtd ? <p className="mt-2 text-xs text-muted">Month to date: the budget is pro-rated to day {throughDay} of {daysInMonth}. Lower is better — cancellations above the budget line are unfavorable.</p> : <p className="mt-2 text-xs text-muted">Lower is better — cancellations above budget are unfavorable.</p>}
            </div>
          ) : (
            <p className="text-sm text-muted">No cancellation budget is set for {monthLabel(month.periodKey)}.</p>
          )}
          {yearPoints.length >= 2 ? (
            <div className="mt-5">
              <div className="mb-1 text-sm text-ink">{year} by month · {branch ? branchLabel(branch) : "Company"}</div>
              <GroupedBars height={220} groups={yearPoints.map((p) => ({ label: p.source === "upload" && p.throughDay != null && p.throughDay < lastDayOf(`${year}-${String(p.m).padStart(2, "0")}`) ? `${p.label}*` : p.label, actual: p.actual ?? 0, budget: p.budget }))} />
              <p className="mt-1 text-xs text-muted">Actuals come from the Monthly Board Report (Jan–Mar from the KPI workbook) where it exists; otherwise from the report uploaded here.{yearPoints.some((p) => p.source === "upload" && p.throughDay != null && p.throughDay < lastDayOf(`${year}-${String(p.m).padStart(2, "0")}`)) ? " * month to date, against the full month's budget." : ""}</p>
            </div>
          ) : null}
        </div>
      </Card>

      {rows.length === 0 ? (
        <div className="mt-4"><EmptyState title="No cancellations match these filters" hint="Clear a filter to widen the view." /></div>
      ) : (
        <>
          {/* Patterns */}
          {patterns.length ? (
            <Card className="mt-4">
              <div className={section}>What stands out</div>
              <ul className="list-disc space-y-1.5 px-4 py-3 pl-8 text-sm text-ink">
                {patterns.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </Card>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {!locked ? (
              <Card>
                <div className={section}>By branch <span className="font-normal text-muted">· click to filter</span></div>
                <div className="p-3"><BarList rows={branchCompare} total={branchTotal} /></div>
              </Card>
            ) : null}
            <Card>
              <div className={section}>By service division</div>
              <div className="p-4"><DivisionDonut slices={divSlices} /></div>
            </Card>
            <Card>
              <div className={section}>By service type</div>
              <div className="p-3"><BarList rows={svcRows} total={svcRows.reduce((s, r) => s + r.value, 0)} max={10} /></div>
            </Card>
            <Card>
              <div className={section}>By route / technician</div>
              <div className="p-3"><BarList rows={routeRows} total={routeRows.reduce((s, r) => s + r.value, 0)} max={10} /></div>
            </Card>
            <Card>
              <div className={section}>By city</div>
              <div className="p-3"><BarList rows={cityRows} total={cityRows.reduce((s, r) => s + r.value, 0)} max={10} /></div>
            </Card>
            <Card>
              <div className={section}>By account value</div>
              <div className="p-3"><BarList rows={bandRows} total={totalValue} max={4} /></div>
            </Card>
          </div>

          {matrixBranches.length > 1 && matrixDivs.length > 1 ? (
            <Card className="mt-4">
              <div className={section}>Branch × division <span className="font-normal text-muted">· darker = more lost value</span></div>
              <div className="overflow-x-auto p-3">
                <table className="w-full min-w-[520px] border-separate border-spacing-[2px] text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th scope="col" className="px-2 py-1 text-left font-medium">Branch</th>
                      {matrixDivs.map((d) => (
                        <th key={d} scope="col" className="px-2 py-1 text-right font-medium">
                          <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: DIVISION_COLORS[d] }} />{DIVISION_LABELS[d]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixBranches.map((b) => (
                      <tr key={b.key}>
                        <th scope="row" className="px-2 py-1.5 text-left font-normal text-ink">{b.label}</th>
                        {matrixDivs.map((d) => {
                          const v = cellOf(b.key, d);
                          const bg = shade(v);
                          const dark = RAMP.indexOf(bg) >= 5;
                          return (
                            <td key={d} className="rounded px-2 py-1.5 text-right tabular-nums" style={{ background: bg, color: dark ? "#ffffff" : "#1d2a23" }} title={`${b.label} · ${DIVISION_LABELS[d]}: ${money0(v)}`}>
                              {v > 0 ? money0(v) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <Card className="mt-4">
            <div className={section}>Trend by month</div>
            <div className="p-3">
              {trendRows.length >= 2 ? (
                <BarList rows={trendRows} total={trendRows.reduce((s, r) => s + r.value, 0)} />
              ) : (
                <p className="text-sm text-muted">One month is loaded ({monthLabel(month.periodKey)}). Month-over-month trends appear here once the next month&apos;s report is uploaded.</p>
              )}
            </div>
          </Card>

          <Card className="mt-4">
            <div className={section}>Accounts <span className="font-normal text-muted">· {rows.length} cancelled service{rows.length === 1 ? "" : "s"}</span></div>
            <AccountTable rows={accountRows} fileLabel={`${month.periodKey}${branch ? `-${branch}` : ""}`} />
          </Card>
        </>
      )}

      {/* MBR check */}
      <Card className="mt-4">
        <div className={section}>Check against the Monthly Board Report</div>
        <div className="p-4 text-sm">
          {mbr.size === 0 ? (
            <p className="text-muted">There&apos;s no Monthly Board Report for {monthLabel(month.periodKey)} yet. When it&apos;s uploaded, this compares its cancellations line to this report, branch by branch, and shows the variance.</p>
          ) : (
            <>
              {isMtd ? <p className="mb-2 text-muted">This report runs through {mdy(month.endDate)}, so it&apos;s a partial month — expect it to sit below the MBR until the full month is uploaded.</p> : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="text-xs text-muted">
                    <tr><th scope="col" className="py-1.5 text-left font-medium">Branch</th><th scope="col" className="py-1.5 text-right font-medium">This report</th><th scope="col" className="py-1.5 text-right font-medium">MBR cancellations</th><th scope="col" className="py-1.5 text-right font-medium">Variance</th></tr>
                  </thead>
                  <tbody>
                    {mbrRows.map((r) => (
                      <tr key={r.key} className="border-t border-line">
                        <td className="py-1.5 text-ink">{r.label}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{money0(r.report)}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{r.mbr != null ? money0(r.mbr) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{r.mbr != null ? `${r.report - r.mbr >= 0 ? "+" : "−"}${money0(Math.abs(r.report - r.mbr))}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>

      <p className="mt-4 text-xs text-muted">
        Not in this report: the cancellation reason and the date each one happened — PestPac&apos;s Gain &amp; Loss Report doesn&apos;t include them. Lost value is the report&apos;s Loss Value for the service. Technician is the route holder when the report was loaded.
        {" "}Loaded {month.createdAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}{month.uploadedBy ? ` by ${month.uploadedBy}` : ""} · {month.fileName}.
      </p>

      {isAdmin ? (
        <Card className="mt-4">
          <div className={section}>Upload a month</div>
          <UploadCard />
        </Card>
      ) : null}
    </>
  );
}
