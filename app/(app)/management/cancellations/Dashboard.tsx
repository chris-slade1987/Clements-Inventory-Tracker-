"use client";

// Cancellation Center — interactive dashboard (client). Branch is the primary
// lens: the branch strip at the top selects the scope (and shows each branch's
// budget pace). One heat map is the explorer — rows are branches (or the routes of
// the selected branch), columns are the chosen dimension (reason, division,
// service type, tenure, account value, city). Clicking a cell, an insight card or
// a branch filters everything below instantly (all rows are in memory), and the
// state is mirrored into the URL so a view can be shared or bookmarked.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountTable, type AccountRow } from "./CancelCharts";
import { GroupedBars } from "@/components/charts";
import { DIVISION_LABELS } from "@/lib/constants";
import { DIVISION_COLORS } from "./CancelCharts";
import { Panel, ColumnChart, DonutChart, type Column, type Slice } from "./Viz";

const DIV_CODE: Record<string, string> = Object.fromEntries(Object.entries(DIVISION_LABELS).map(([code, label]) => [label, code]));
const DIV_ORDER = ["GHP", "LO", "TERMITE", "MOSQUITO", "RODENT", "OTHER"];
// Reason colors follow the reason (fixed by its month-wide rank), never its rank in the current view.
const REASON_COLORS = ["#2a78d6", "#1baf7a", "#eda100", "#4a3aa7", "#e34948", "#008300"];
const OTHER_COLOR = "#8a968f";

export type YearPoint = { label: string; actual: number; budget: number | null; partial: boolean; fromUpload: boolean };
export type Extra = { branch: string; account: string; customer: string; serviceCode: string; chargeType: string; techCode: string; reason: string; total: number };

export function MonthSelect({ months, value }: { months: { value: string; label: string }[]; value: string }) {
  const router = useRouter();
  if (months.length < 2) return <span className="text-sm text-muted">{months[0]?.label}</span>;
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Month
      <select className="min-h-[40px] rounded-lg border border-line bg-white px-3 text-sm text-ink" value={value}
        onChange={(e) => router.push(`?m=${e.target.value}`)}>
        {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
    </label>
  );
}

export type DashRow = {
  account: string;
  customer: string;
  city: string;
  zip: string;
  branch: string;
  route: string;
  tech: string;
  serviceCode: string;
  division: string; // label
  reason: string; // "" when no reason list is loaded / matched
  since: string; // YYYY-MM-DD or ""
  tenure: string; // band key or ""
  value: string; // band key
  lossCount: number;
  lossValue: number;
};

export type BranchCard = { key: string; label: string; budget: number | null; toDate: number | null };

type Filters = { branch: string; route: string; reason: string; division: string; service: string; tenure: string; value: string; city: string; multi: string };
const EMPTY: Filters = { branch: "", route: "", reason: "", division: "", service: "", tenure: "", value: "", city: "", multi: "" };

type Dim = "reason" | "division" | "service" | "tenure" | "value" | "city";
const DIMS: { key: Dim; label: string; field: keyof DashRow; filter: keyof Filters }[] = [
  { key: "reason", label: "Cancel reason", field: "reason", filter: "reason" },
  { key: "division", label: "Division", field: "division", filter: "division" },
  { key: "service", label: "Service type", field: "serviceCode", filter: "service" },
  { key: "tenure", label: "Customer tenure", field: "tenure", filter: "tenure" },
  { key: "value", label: "Account value", field: "value", filter: "value" },
  { key: "city", label: "City", field: "city", filter: "city" },
];
export const TENURE_BANDS = [
  { key: "lt1", label: "Under 1 yr" },
  { key: "1-2", label: "1–2 yrs" },
  { key: "2-5", label: "2–5 yrs" },
  { key: "5+", label: "5+ yrs" },
];
export const VALUE_BANDS = [
  { key: "lt300", label: "Under $300" },
  { key: "300", label: "$300–599" },
  { key: "600", label: "$600–999" },
  { key: "1000", label: "$1,000+" },
];
const BAND_LABEL: Record<string, string> = Object.fromEntries([...TENURE_BANDS, ...VALUE_BANDS].map((b) => [b.key, b.label]));
const FILTER_LABEL: Record<keyof Filters, string> = { branch: "Branch", route: "Route", reason: "Reason", division: "Division", service: "Service", tenure: "Tenure", value: "Account value", city: "City", multi: "" };

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const moneyK = (n: number) => (n >= 10_000 ? `$${(n / 1000).toFixed(1)}K` : money0(n));
const RAMP = ["#eef4f0", "#dce9df", "#c3dac9", "#a3c6ab", "#74a96e", "#4f8a5f", "#2e6f47", "#1f5836", "#0b3d20"];
const shade = (v: number, max: number) => (v <= 0 ? null : RAMP[Math.min(RAMP.length - 1, 1 + Math.floor((v / Math.max(max, 1)) * (RAMP.length - 2)))]);
const isDark = (c: string | null) => !!c && RAMP.indexOf(c) >= 5;

type Agg = { value: number; count: number; accounts: Set<string> };
const agg = (): Agg => ({ value: 0, count: 0, accounts: new Set() });
const add = (a: Agg, r: DashRow) => { a.value += r.lossValue; a.count += r.lossCount; a.accounts.add(r.account); };

export function CancellationDashboard({
  rows,
  branches,
  lockedBranch,
  reasonsLoaded,
  initial,
  periodLabel,
  isMtd,
  throughLabel,
  fileLabel,
  yearByScope,
  mbr,
  extras,
  year,
  children,
}: {
  rows: DashRow[];
  branches: BranchCard[];
  lockedBranch: string | null;
  reasonsLoaded: boolean;
  initial: Partial<Filters> & { dim?: string; metric?: string };
  periodLabel: string;
  isMtd: boolean;
  throughLabel: string;
  fileLabel: string;
  yearByScope: Record<string, YearPoint[]>;
  mbr: Record<string, number | null>; // MBR cancellations (month) by scope; empty when no MBR for the month
  extras: Extra[];
  year: number;
  children?: React.ReactNode; // admin-only upload, rendered by the server
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>({ ...EMPTY, ...pick(initial), ...(lockedBranch ? { branch: lockedBranch } : {}) });
  const [dim, setDim] = useState<Dim>(DIMS.some((d) => d.key === initial.dim) ? (initial.dim as Dim) : reasonsLoaded ? "reason" : "division");
  const [metric, setMetric] = useState<"value" | "count">(initial.metric === "count" ? "count" : "value");
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sync = (next: Filters, d = dim, m = metric) => {
    const q = new URLSearchParams(window.location.search);
    for (const k of Object.keys(EMPTY) as (keyof Filters)[]) {
      if (next[k] && !(k === "branch" && lockedBranch)) q.set(k, next[k]); else q.delete(k);
    }
    q.set("dim", d);
    if (m === "count") q.set("metric", "count"); else q.delete("metric");
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  };
  const update = (patch: Partial<Filters>) => {
    const next = { ...f, ...patch };
    if ("branch" in patch && patch.branch !== f.branch) next.route = "";
    setF(next);
    sync(next);
  };
  const toggle = (k: keyof Filters, v: string) => update({ [k]: f[k] === v ? "" : v } as Partial<Filters>);

  const multiAccounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.account, (m.get(r.account) ?? 0) + 1);
    return new Set([...m].filter(([, n]) => n >= 2).map(([a]) => a));
  }, [rows]);

  const match = (r: DashRow, skip: (keyof Filters)[] = []) =>
    (skip.includes("branch") || !f.branch || r.branch === f.branch) &&
    (skip.includes("route") || !f.route || r.route === f.route) &&
    (skip.includes("reason") || !f.reason || (r.reason || "(none)") === f.reason) &&
    (skip.includes("division") || !f.division || r.division === f.division) &&
    (skip.includes("service") || !f.service || r.serviceCode === f.service) &&
    (skip.includes("tenure") || !f.tenure || r.tenure === f.tenure) &&
    (skip.includes("value") || !f.value || r.value === f.value) &&
    (skip.includes("city") || !f.city || r.city === f.city) &&
    (skip.includes("multi") || !f.multi || multiAccounts.has(r.account));

  const inView = rows.filter((r) => match(r));
  const branchRows = rows.filter((r) => !f.branch || r.branch === f.branch); // insights scope

  // ---- Branch strip (always unfiltered except by branch itself) ---------------
  const strip = branches.map((b) => {
    const a = agg();
    for (const r of rows) if (b.key === "all" || r.branch === b.key) add(a, r);
    return { ...b, ...a, accountsN: a.accounts.size };
  });

  // ---- Insights (scoped to the selected branch) ----------------------------------
  const insights = useMemo(() => buildInsights(branchRows, multiAccounts, reasonsLoaded), [branchRows, multiAccounts, reasonsLoaded]);

  // ---- Heat map --------------------------------------------------------------------
  const D = DIMS.find((d) => d.key === dim)!;
  const rowMode: "branch" | "route" = f.branch ? "route" : "branch";
  const base = rows.filter((r) => match(r, [D.filter, rowMode === "branch" ? "branch" : "route"]));
  const colKey = (r: DashRow) => String(r[D.field] || (dim === "reason" ? "(none)" : "—"));
  const colTotals = new Map<string, Agg>();
  for (const r of base) { const k = colKey(r); const a = colTotals.get(k) ?? agg(); add(a, r); colTotals.set(k, a); }
  const bucket = (r: DashRow) => { const k = colKey(r); return hiddenSet.has(k) ? "__other" : k; };
  const hiddenSet = new Set<string>();
  let cols = [...colTotals.keys()];
  if (dim === "tenure") cols = TENURE_BANDS.map((b) => b.key).filter((k) => colTotals.has(k)).concat(cols.filter((k) => !BAND_LABEL[k]));
  else if (dim === "value") cols = VALUE_BANDS.map((b) => b.key).filter((k) => colTotals.has(k));
  else cols.sort((a, b) => colTotals.get(b)!.value - colTotals.get(a)!.value);
  // Keep the grid readable: the top 5 columns, the rest folded into "Other"
  // (the selected column always stays visible). "Show all" expands it.
  const OTHER = "__other";
  let hidden: string[] = [];
  if (!showAll && cols.length > 6) {
    const keep = cols.slice(0, 5);
    if (f[D.filter] && cols.includes(f[D.filter]) && !keep.includes(f[D.filter])) keep[4] = f[D.filter];
    hidden = cols.filter((c) => !keep.includes(c));
    cols = [...keep, OTHER];
    const o = agg();
    for (const h of hidden) { hiddenSet.add(h); }
    for (const r of base) if (hiddenSet.has(colKey(r))) add(o, r);
    colTotals.set(OTHER, o);
  }
  const colLabel = (k: string) => (k === OTHER ? `${hidden.length} more` : dim === "tenure" || dim === "value" ? BAND_LABEL[k] ?? "Unknown" : k === "(none)" ? "No reason" : k);

  const rowKeyOf = (r: DashRow) => (rowMode === "branch" ? r.branch : r.route);
  const rowTotals = new Map<string, Agg>();
  const cells = new Map<string, Agg>();
  for (const r of base) {
    const rk = rowKeyOf(r);
    const ra = rowTotals.get(rk) ?? agg(); add(ra, r); rowTotals.set(rk, ra);
    const ck = `${rk}|${bucket(r)}`;
    const ca = cells.get(ck) ?? agg(); add(ca, r); cells.set(ck, ca);
  }
  const branchLabel = (k: string) => branches.find((b) => b.key === k)?.label ?? k;
  const techOf = new Map(rows.map((r) => [`${r.branch}|${r.route}`, r.tech]));
  let heatRows = [...rowTotals.keys()];
  if (rowMode === "branch") heatRows = branches.map((b) => b.key).filter((k) => rowTotals.has(k));
  else heatRows.sort((a, b) => rowTotals.get(b)!.value - rowTotals.get(a)!.value);
  const rowLabel = (k: string) => (rowMode === "branch" ? branchLabel(k) : `Route ${k}`);
  const rowSub = (k: string) => (rowMode === "route" ? techOf.get(`${f.branch}|${k}`) ?? "" : "");
  const metricOf = (a: Agg | undefined) => (a ? (metric === "value" ? a.value : a.count) : 0);
  const cellMax = Math.max(1, ...[...cells.values()].map(metricOf));
  const grand = agg();
  for (const r of base) add(grand, r);

  const cellTip = (e: React.MouseEvent | React.FocusEvent, rk: string, ck: string | null) => {
    const a = ck ? cells.get(`${rk}|${ck}`) : rowTotals.get(rk);
    const rt = rowTotals.get(rk);
    const el = e.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    const host = (el.closest("[data-heat]") as HTMLElement).getBoundingClientRect();
    const title = `${rowLabel(rk)}${ck ? ` · ${ck === "__other" ? `Other (${hidden.join(", ")})` : colLabel(ck)}` : ""}`;
    const lines = a
      ? [
          title,
          `${money0(a.value)} lost · ${a.count} service${a.count === 1 ? "" : "s"} · ${a.accounts.size} account${a.accounts.size === 1 ? "" : "s"}`,
          ...(ck && rt ? [`${Math.round((a.value / Math.max(1, rt.value)) * 100)}% of ${rowLabel(rk)}'s lost value`] : []),
          ...(ck ? [`${Math.round((a.value / Math.max(1, colTotals.get(ck)?.value ?? 1)) * 100)}% of all ${colLabel(ck)}`] : []),
          ck === "__other" ? "Click “more” in the header to break these out" : "Click to filter to these accounts",
        ]
      : [title, "No cancellations"];
    setTip({ x: box.left - host.left + box.width / 2, y: box.top - host.top, lines });
  };
  const clickCell = (rk: string, ck: string | null) => {
    const patch: Partial<Filters> = {};
    if (rowMode === "branch") { if (!lockedBranch) patch.branch = rk; } else patch.route = f.route === rk && (!ck || f[D.filter] === ck) ? "" : rk;
    if (ck) patch[D.filter] = f[D.filter] === ck && (rowMode === "branch" || f.route === rk) ? "" : ck;
    if (rowMode === "branch" && !ck && !lockedBranch) patch.branch = rk;
    update(patch);
    setTip(null);
  };

  // ---- Active filter chips -------------------------------------------------------
  const chips = (Object.keys(EMPTY) as (keyof Filters)[])
    .filter((k) => f[k] && !(k === "branch" && lockedBranch))
    .map((k) => ({
      k,
      label: k === "multi" ? "Accounts that cancelled 2+ services"
        : k === "branch" ? branchLabel(f.branch)
        : k === "route" ? `Route ${f.route}${techOf.get(`${f.branch}|${f.route}`) ? ` · ${techOf.get(`${f.branch}|${f.route}`)}` : ""}`
        : k === "tenure" || k === "value" ? `${FILTER_LABEL[k]}: ${BAND_LABEL[f[k]] ?? f[k]}`
        : k === "reason" && f.reason === "(none)" ? "Reason: none on file"
        : `${FILTER_LABEL[k]}: ${f[k]}`,
    }));

  const totals = agg();
  for (const r of inView) add(totals, r);
  const accountRows: AccountRow[] = inView.map((r) => ({
    reason: r.reason, since: r.since ? mdy(r.since) : "", account: r.account, customer: r.customer, city: r.city, zip: r.zip,
    branch: branchLabel(r.branch), route: r.route, tech: r.tech, serviceCode: r.serviceCode, division: r.division, lossCount: r.lossCount, lossValue: r.lossValue,
  }));

  // ---- Dashboard panels (each applies every filter except its own dimension) ----
  const sumBy = (rs: DashRow[], key: (r: DashRow) => string) => {
    const m = new Map<string, Agg>();
    for (const r of rs) { const k = key(r); const a = m.get(k) ?? agg(); add(a, r); m.set(k, a); }
    return m;
  };
  // A. Lost value by branch (or by route inside a branch), stacked by division.
  const stackBase = rows.filter((r) => match(r, rowMode === "branch" ? ["branch", "route"] : ["route"]));
  const stackKeys = rowMode === "branch"
    ? branches.map((b) => b.key).filter((k) => k !== "all" && stackBase.some((r) => r.branch === k))
    : [...sumBy(stackBase, (r) => r.route)].sort((a, b) => b[1].value - a[1].value).slice(0, 12).map(([k]) => k);
  const divsPresent = DIV_ORDER.filter((code) => stackBase.some((r) => (DIV_CODE[r.division] ?? "OTHER") === code));
  const stackCols: Column[] = stackKeys.map((k) => {
    const rs = stackBase.filter((r) => (rowMode === "branch" ? r.branch === k : r.route === k));
    const byDiv = sumBy(rs, (r) => DIV_CODE[r.division] ?? "OTHER");
    return {
      key: k,
      label: rowMode === "branch" ? branchLabel(k) : k,
      sub: rowMode === "route" ? (techOf.get(`${f.branch}|${k}`) ?? "").split(" ")[0] : undefined,
      active: rowMode === "branch" ? f.branch === k : f.route === k,
      segments: divsPresent.filter((d) => byDiv.has(d)).map((d) => ({ key: d, label: DIVISION_LABELS[d as keyof typeof DIVISION_LABELS], value: byDiv.get(d)!.value, count: byDiv.get(d)!.count, color: DIVISION_COLORS[d] ?? OTHER_COLOR })),
    };
  });
  const divLegend = divsPresent.map((d) => ({ key: d, label: DIVISION_LABELS[d as keyof typeof DIVISION_LABELS], color: DIVISION_COLORS[d] ?? OTHER_COLOR }));

  // B. Cancel reasons donut (top 6 + Other).
  const reasonRank = [...sumBy(rows, (r) => r.reason || "(none)")].sort((a, b) => b[1].value - a[1].value).map(([k]) => k);
  const reasonColor = (k: string) => { const i = reasonRank.filter((x) => x !== "(none)").indexOf(k); return i >= 0 && i < REASON_COLORS.length ? REASON_COLORS[i] : OTHER_COLOR; };
  const reasonAgg = [...sumBy(rows.filter((r) => match(r, ["reason"])), (r) => r.reason || "(none)")].sort((a, b) => b[1].value - a[1].value);
  const topReasons = reasonAgg.filter(([k]) => reasonColor(k) !== OTHER_COLOR);
  const restReasons = reasonAgg.filter(([k]) => reasonColor(k) === OTHER_COLOR);
  const reasonSlices: Slice[] = [
    ...topReasons.map(([k, a]) => ({ key: k, label: k, value: a.value, count: a.count, color: reasonColor(k), active: f.reason === k })),
    ...(restReasons.length ? [{ key: "__other", label: `Other (${restReasons.length})`, value: restReasons.reduce((s, [, a]) => s + a.value, 0), count: restReasons.reduce((s, [, a]) => s + a.count, 0), color: OTHER_COLOR }] : []),
  ];

  // C. Single-dimension column panels.
  const single = (dimKey: keyof Filters, key: (r: DashRow) => string, order: { key: string; label: string }[] | null, limit = 8): Column[] => {
    const m = sumBy(rows.filter((r) => match(r, [dimKey])), key);
    const keys = order ? order.map((o) => o.key).filter((k) => m.has(k)) : [...m].sort((a, b) => b[1].value - a[1].value).slice(0, limit).map(([k]) => k);
    return keys.map((k) => ({ key: k, label: order?.find((o) => o.key === k)?.label ?? k, active: f[dimKey] === k, segments: [{ key: k, label: k, value: m.get(k)!.value, count: m.get(k)!.count, color: "#2e6f47" }] }));
  };
  const serviceCols = single("service", (r) => r.serviceCode, null, 6);
  const tenureCols = reasonsLoaded ? single("tenure", (r) => r.tenure || "?", [{ key: "lt1", label: "<1 yr" }, { key: "1-2", label: "1–2 yrs" }, { key: "2-5", label: "2–5 yrs" }, { key: "5+", label: "5+ yrs" }]) : [];
  const valueCols = single("value", (r) => r.value, [{ key: "lt300", label: "<$300" }, { key: "300", label: "$300–599" }, { key: "600", label: "$600–999" }, { key: "1000", label: "$1K+" }]);
  const scopeName = f.branch ? branchLabel(f.branch) : "all branches";

  const seg = (on: boolean) =>
    `min-h-[40px] rounded-lg px-3 text-sm transition-colors ${on ? "bg-forest text-white shadow-sm" : "text-ink hover:bg-brand-50"}`;

  return (
    <div className="@container space-y-4">
      {/* Branch strip — the primary lens */}
      <section aria-label="Branches" className={lockedBranch ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0"}>
        {strip.filter((b) => !lockedBranch || b.key === lockedBranch).map((b) => {
          const on = (b.key === "all" && !f.branch) || f.branch === b.key;
          const over = b.toDate != null ? b.value - b.toDate : null;
          return (
            <button
              key={b.key}
              type="button"
              aria-pressed={on}
              disabled={!!lockedBranch}
              onClick={() => update({ branch: b.key === "all" ? "" : b.key })}
              className={`group min-w-[190px] shrink-0 snap-start rounded-xl border p-4 text-left transition-all lg:min-w-0 ${on ? "border-forest bg-white shadow-[0_0_0_2px_rgba(11,61,32,0.9)]" : "border-line bg-white hover:border-brand-400 hover:shadow-sm"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-muted">{b.label}</span>
                {on && !lockedBranch ? <span className="rounded-full bg-forest px-2 py-0.5 text-[10px] uppercase tracking-wide text-white">Viewing</span> : null}
              </div>
              <div className="mt-1 text-2xl font-light tabular-nums text-ink">{money0(b.value)}</div>
              <div className="whitespace-nowrap text-xs text-muted">{b.count} svcs · {b.accountsN} accts</div>
              {b.budget != null && b.toDate != null ? (
                <>
                  <div className="mt-3 flex items-center gap-2.5">
                    <PaceRing pct={b.value / Math.max(1, b.toDate)} />
                    <div className={`text-sm leading-tight ${over != null && over > 0 ? "text-red-700" : "text-brand-700"}`}>
                      {over == null ? "" : over > 0 ? <>+{money0(over)}<br /><span className="text-xs">over {isMtd ? "pace" : "budget"}</span></> : <>{money0(-over)}<br /><span className="text-xs">under {isMtd ? "pace" : "budget"}</span></>}
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] leading-snug text-muted">Budget {money0(b.budget)}{isMtd ? ` · pace ${money0(b.toDate)} by ${throughLabel}` : ""}</div>
                </>
              ) : null}
            </button>
          );
        })}
      </section>

      {/* Insights — each one is a shortcut into the data */}
      {insights.length ? (
        <section aria-label="What stands out">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-ink">What stands out{f.branch ? ` in ${branchLabel(f.branch)}` : ""}</h2>
            <span className="text-xs text-muted">Tap a card to see those accounts</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {insights.map((ins) => {
              const on = Object.entries(ins.filter).every(([k, v]) => f[k as keyof Filters] === v);
              return (
                <button key={ins.key} type="button" aria-pressed={on}
                  onClick={() => update(on ? Object.fromEntries(Object.keys(ins.filter).map((k) => [k, ""])) : ins.filter)}
                  className={`flex flex-col items-start justify-start rounded-xl border bg-white p-4 text-left transition-all ${on ? "border-forest shadow-[0_0_0_2px_rgba(11,61,32,0.9)]" : "border-line hover:border-brand-400 hover:shadow-sm"}`}>
                  <div className="text-xs uppercase tracking-wide text-muted">{ins.eyebrow}</div>
                  <div className="mt-1 text-xl font-light text-ink">{ins.headline}</div>
                  <div className="mt-1 text-sm text-muted">{ins.detail}</div>
                  <div className="mt-auto pt-2 text-xs text-brand-700">{on ? "Showing these accounts · tap to clear" : "See accounts →"}</div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Dashboard panels — vertical charts in a uniform grid; click any mark to drill */}
      <div className="grid gap-4 @3xl:grid-cols-3">
        <Panel className="@3xl:col-span-2"
          title={rowMode === "branch" ? "Lost value by branch" : `Lost value by route · ${branchLabel(f.branch)}`}
          subtitle={rowMode === "branch" ? "Stacked by service division. Click a branch to see its routes; click a color to filter that division." : "Top routes, stacked by division. Click a route or a color to filter."}>
          <ColumnChart columns={stackCols} legend={divLegend} height={300}
            onColumn={(k) => clickCell(k, null)}
            onSegment={(k, d) => update(rowMode === "branch" ? { ...(lockedBranch ? {} : { branch: k }), division: DIVISION_LABELS[d as keyof typeof DIVISION_LABELS] } : { route: k, division: DIVISION_LABELS[d as keyof typeof DIVISION_LABELS] })} />
        </Panel>
        <Panel title="Cancel reasons" subtitle={reasonsLoaded ? `Share of lost value · ${scopeName}` : "Upload the Service Setup List to see reasons"}>
          {reasonsLoaded ? <DonutChart slices={reasonSlices} onSlice={(k) => { if (k !== "__other") toggle("reason", k); }} /> : <p className="py-10 text-center text-sm text-muted">No reasons loaded for this month.</p>}
        </Panel>
      </div>

      {/* Explorer heat map */}
      <section aria-label="Explore" className="rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-ink">
              {rowMode === "branch" ? "Branches" : `${branchLabel(f.branch)} routes`} by {D.label.toLowerCase()}
            </h2>
            <p className="text-xs text-muted">Darker = more {metric === "value" ? "lost value" : "cancelled services"}. Click any cell, row or column total to filter{rowMode === "branch" && !lockedBranch ? "; click a branch to see its routes" : ""}.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Show" className="flex rounded-xl border border-line bg-[#f4f6f5] p-1">
              <button type="button" className={seg(metric === "value")} aria-pressed={metric === "value"} onClick={() => { setMetric("value"); sync(f, dim, "value"); }}>Lost $</button>
              <button type="button" className={seg(metric === "count")} aria-pressed={metric === "count"} onClick={() => { setMetric("count"); sync(f, dim, "count"); }}>Services</button>
            </div>
          </div>
        </div>
        <div role="tablist" aria-label="Break out by" className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
          {DIMS.filter((d) => d.key !== "reason" || reasonsLoaded).filter((d) => d.key !== "tenure" || reasonsLoaded).map((d) => (
            <button key={d.key} role="tab" aria-selected={dim === d.key} type="button" className={`${seg(dim === d.key)} whitespace-nowrap`} onClick={() => { setDim(d.key); setShowAll(false); sync(f, d.key, metric); }}>
              {d.label}
            </button>
          ))}
        </div>
        {showAll && hidden.length === 0 && cols.length > 6 ? (
          <div className="px-4 pt-2 text-right"><button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setShowAll(false)}>Show top 5 only</button></div>
        ) : null}
        <div className="relative" data-heat onMouseLeave={() => setTip(null)}>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-[3px] p-2 text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-[1] min-w-[128px] bg-white px-2 py-2 text-left text-xs font-medium text-muted">{rowMode === "branch" ? "Branch" : "Route"}</th>
                  {cols.map((c) => (
                    <th key={c} scope="col" className="min-w-[76px] px-0.5 py-2 align-bottom">
                      {c === OTHER ? (
                        <button type="button" onClick={() => setShowAll(true)} className="w-full rounded-md border border-dashed border-brand-300 px-1 py-1 text-center text-[11px] font-medium leading-tight text-brand-700 hover:bg-brand-50">
                          {colLabel(c)} →
                        </button>
                      ) : (
                        <button type="button" onClick={() => toggle(D.filter, c)} className={`w-full rounded-md px-1 py-1 text-center text-[11px] font-medium leading-tight ${f[D.filter] === c ? "bg-forest text-white" : "text-muted hover:bg-brand-50 hover:text-ink"}`}>
                          {colLabel(c)}
                        </button>
                      )}
                    </th>
                  ))}
                  <th scope="col" className="min-w-[80px] px-2 py-2 text-right text-xs font-medium text-muted">Total</th>
                </tr>
              </thead>
              <tbody>
                {heatRows.map((rk) => {
                  const rowOn = rowMode === "branch" ? f.branch === rk : f.route === rk;
                  return (
                    <tr key={rk}>
                      <th scope="row" className="sticky left-0 z-[1] bg-white px-1 py-0.5 text-left font-normal">
                        <button type="button" onClick={() => clickCell(rk, null)} onMouseEnter={(e) => cellTip(e, rk, null)} onFocus={(e) => cellTip(e, rk, null)}
                          className={`w-full rounded-md px-2 py-1.5 text-left ${rowOn ? "bg-forest text-white" : "text-ink hover:bg-brand-50"}`}>
                          <div className="truncate">{rowLabel(rk)}</div>
                          {rowSub(rk) ? <div className={`truncate text-[11px] ${rowOn ? "text-white/80" : "text-muted"}`}>{rowSub(rk)}</div> : null}
                        </button>
                      </th>
                      {cols.map((c) => {
                        const a = cells.get(`${rk}|${c}`);
                        const v = metricOf(a);
                        const bg = shade(v, cellMax);
                        const on = rowOn && f[D.filter] === c;
                        return (
                          <td key={c} className="p-0">
                            <button type="button" disabled={!a}
                              onClick={() => (c === OTHER ? setShowAll(true) : clickCell(rk, c))} onMouseEnter={(e) => cellTip(e, rk, c)} onFocus={(e) => cellTip(e, rk, c)}
                              className={`h-12 w-full rounded-md text-center tabular-nums transition-[outline] ${a ? "cursor-pointer hover:outline hover:outline-2 hover:outline-forest" : "cursor-default"} ${on ? "outline outline-[3px] outline-[#e3b23c]" : ""}`}
                              style={{ background: bg ?? "#f7f8f7", color: isDark(bg) ? "#ffffff" : bg ? "#1d2a23" : "#b7c0bb" }}>
                              {a ? (metric === "value" ? moneyK(a.value) : a.count) : "·"}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 text-right tabular-nums text-ink">{metric === "value" ? money0(rowTotals.get(rk)?.value ?? 0) : rowTotals.get(rk)?.count ?? 0}</td>
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row" className="sticky left-0 z-[1] bg-white px-3 py-2 text-left text-xs font-medium text-muted">Total</th>
                  {cols.map((c) => (
                    <td key={c} className="px-1 py-2 text-center text-xs tabular-nums text-ink">{metric === "value" ? moneyK(colTotals.get(c)?.value ?? 0) : colTotals.get(c)?.count ?? 0}</td>
                  ))}
                  <td className="px-2 py-2 text-right text-sm font-medium tabular-nums text-ink">{metric === "value" ? money0(grand.value) : grand.count}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {tip ? (
            <div role="tooltip" className="pointer-events-none absolute z-20 w-max max-w-[280px] -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink shadow-lg" style={{ left: tip.x, top: tip.y - 6 }}>
              <div className="font-medium">{tip.lines[0]}</div>
              {tip.lines.slice(1, -1).map((l) => <div key={l} className="tabular-nums">{l}</div>)}
              {tip.lines.length > 2 ? <div className="mt-1 text-brand-700">{tip.lines[tip.lines.length - 1]}</div> : null}
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-4 @3xl:grid-cols-3">
        <Panel title="Top service types" subtitle="Lost value, top 6. Click to filter.">
          <ColumnChart columns={serviceCols} height={210} onColumn={(k) => toggle("service", k)} />
        </Panel>
        <Panel title="Customer tenure" subtitle="How long the service had run. Click to filter.">
          {reasonsLoaded ? <ColumnChart columns={tenureCols} height={210} onColumn={(k) => toggle("tenure", k)} /> : <p className="py-10 text-center text-sm text-muted">Comes from the Service Setup List.</p>}
        </Panel>
        <Panel title="Account value" subtitle="Lost value by size of the service. Click to filter.">
          <ColumnChart columns={valueCols} height={210} onColumn={(k) => toggle("value", k)} />
        </Panel>
      </div>

      {/* Accounts in view */}
      <section aria-label="Accounts" className="rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="mr-1 text-sm font-medium text-ink">Accounts in view</h2>
          <span className="text-sm tabular-nums text-muted">{money0(totals.value)} · {totals.count} service{totals.count === 1 ? "" : "s"} · {totals.accounts.size} account{totals.accounts.size === 1 ? "" : "s"}</span>
          <div className="flex flex-1 flex-wrap justify-end gap-1.5">
            {chips.map((c) => (
              <button key={c.k} type="button" onClick={() => update({ [c.k]: "" } as Partial<Filters>)}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-3 text-xs text-brand-800 hover:bg-brand-100" aria-label={`Remove filter ${c.label}`}>
                {c.label}
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            ))}
            {chips.length ? <button type="button" onClick={() => { const next = { ...EMPTY, ...(lockedBranch ? { branch: lockedBranch } : {}) }; setF(next); sync(next); }} className="min-h-[32px] px-2 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">Clear all</button> : null}
          </div>
        </div>
        <AccountTable rows={accountRows} fileLabel={`${fileLabel}${f.branch ? `-${f.branch}` : ""}`} />
      </section>

      {/* Secondary: budget by month · MBR check */}
      <div className="grid gap-4 @3xl:grid-cols-3">
        <section aria-label="Budget by month" className="rounded-xl border border-line bg-white @3xl:col-span-2">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium text-ink">{year} cancellations vs budget · {f.branch ? branchLabel(f.branch) : "Company"}</h2>
            <p className="text-xs text-muted">Budget = the 2026 branch cancellation targets the quarterly scorecards use. Lower is better.</p>
          </div>
          <div className="p-4">
            {(yearByScope[f.branch || "all"] ?? []).length >= 2 ? (
              <>
                <GroupedBars height={210} groups={(yearByScope[f.branch || "all"] ?? []).map((p) => ({ label: p.partial ? `${p.label}*` : p.label, actual: p.actual, budget: p.budget }))} />
                <p className="mt-1 text-xs text-muted">Actuals from the Monthly Board Report where it exists, otherwise from the reports uploaded here.{(yearByScope[f.branch || "all"] ?? []).some((p) => p.partial) ? " * month to date, against the full month's budget." : ""}</p>
              </>
            ) : <p className="text-sm text-muted">The by-month view appears once two months have actuals.</p>}
          </div>
        </section>
        <section aria-label="MBR check" className="rounded-xl border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium text-ink">Check against the MBR</h2>
            <p className="text-xs text-muted">This report vs the Monthly Board Report&apos;s cancellations line.</p>
          </div>
          <div className="p-4 text-sm">
            {Object.keys(mbr).length === 0 ? (
              <p className="text-muted">No Monthly Board Report for this month yet. Once it&apos;s uploaded, each branch&apos;s variance shows here.</p>
            ) : (
              <table className="w-full">
                <thead className="text-xs text-muted"><tr><th scope="col" className="py-1 text-left font-medium">Branch</th><th scope="col" className="py-1 text-right font-medium">Report</th><th scope="col" className="py-1 text-right font-medium">MBR</th><th scope="col" className="py-1 text-right font-medium">Variance</th></tr></thead>
                <tbody>
                  {strip.filter((b) => (lockedBranch ? b.key === lockedBranch : true)).map((b) => {
                    const m = mbr[b.key === "all" ? "company" : b.key];
                    return (
                      <tr key={b.key} className="border-t border-line">
                        <td className="py-1.5 text-ink">{b.label}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{money0(b.value)}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{m != null ? money0(m) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{m != null ? `${b.value - m >= 0 ? "+" : "−"}${money0(Math.abs(b.value - m))}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {extras.filter((x) => !f.branch || x.branch === f.branch).length ? (
        <details className="rounded-xl border border-line bg-white">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm text-ink">
            <span className="font-medium">Also cancelled, not on the Gain &amp; Loss Report</span>
            <span className="text-muted"> · {extras.filter((x) => !f.branch || x.branch === f.branch).length} invoice / yearly-renewal setups, not counted in lost value · show</span>
          </summary>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-[#f4f6f5] text-xs text-muted">
                <tr>{["Account", "Customer", "Branch", "Service", "Reason"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}<th scope="col" className="px-3 py-2 text-right font-medium">Setup total</th></tr>
              </thead>
              <tbody>
                {extras.filter((x) => !f.branch || x.branch === f.branch).map((x, i) => (
                  <tr key={`${x.account}-${x.serviceCode}-${i}`} className="border-t border-line">
                    <td className="px-3 py-2 tabular-nums text-muted">{x.account}</td>
                    <td className="px-3 py-2 text-ink">{x.customer}</td>
                    <td className="px-3 py-2 text-ink">{branchLabel(x.branch)}</td>
                    <td className="px-3 py-2 text-ink">{x.serviceCode}<span className="text-muted"> · {x.chargeType || x.techCode}</span></td>
                    <td className="px-3 py-2 text-ink">{x.reason}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{money0(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {children}

      <p className="text-xs text-muted">
        {periodLabel}. Month changes reload the page; everything else filters instantly.{" "}
        <button type="button" className="underline-offset-2 hover:underline" onClick={() => router.refresh()}>Refresh data</button>
      </p>
    </div>
  );
}

/** Ring gauge: actual as a share of budget-to-date. Past 100% the ring turns red
 *  and a second lap shows how far over. Text beside it carries the status. */
function PaceRing({ pct }: { pct: number }) {
  const R = 20, C = 2 * Math.PI * R;
  const over = pct > 1;
  const first = Math.min(pct, 1), second = over ? Math.min(pct - 1, 1) : 0;
  return (
    <svg viewBox="0 0 52 52" width="52" height="52" className="shrink-0" role="img" aria-label={`${Math.round(pct * 100)}% of budget pace`}>
      <circle cx="26" cy="26" r={R} fill="none" stroke="#eef1ef" strokeWidth="5" />
      <circle cx="26" cy="26" r={R} fill="none" stroke={over ? "#e8a9a3" : "#2e6f47"} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${first * C} ${C}`} transform="rotate(-90 26 26)" />
      {second > 0 ? <circle cx="26" cy="26" r={R} fill="none" stroke="#c0392b" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${second * C} ${C}`} transform="rotate(-90 26 26)" /> : null}
      <text x="26" y="30" textAnchor="middle" fontSize="11" fill="#1d2a23">{Math.round(pct * 100)}%</text>
    </svg>
  );
}

function pick(o: Record<string, unknown>): Partial<Filters> {
  const out: Partial<Filters> = {};
  for (const k of Object.keys(EMPTY) as (keyof Filters)[]) if (typeof o[k] === "string" && o[k]) out[k] = o[k] as string;
  return out;
}

function mdy(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

type Insight = { key: string; eyebrow: string; headline: string; detail: string; filter: Partial<Filters> };

function buildInsights(rows: DashRow[], multi: Set<string>, reasonsLoaded: boolean): Insight[] {
  if (!rows.length) return [];
  const total = rows.reduce((s, r) => s + r.lossValue, 0) || 1;
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  const out: Insight[] = [];
  const by = (key: (r: DashRow) => string) => {
    const m = new Map<string, { value: number; count: number; tech: string }>();
    for (const r of rows) { const k = key(r); const g = m.get(k) ?? { value: 0, count: 0, tech: r.tech }; g.value += r.lossValue; g.count += r.lossCount; m.set(k, g); }
    return [...m].sort((a, b) => b[1].value - a[1].value);
  };
  if (reasonsLoaded) {
    const top = by((r) => r.reason || "(none)").find(([k]) => k !== "(none)");
    if (top) out.push({ key: "reason", eyebrow: "Top reason", headline: top[0], detail: `${money0(top[1].value)} · ${top[1].count} services · ${pct(top[1].value)} of lost value`, filter: { reason: top[0] } });
  }
  const route = by((r) => `${r.branch}|${r.route}`)[0];
  if (route) {
    const [b, rt] = route[0].split("|");
    out.push({ key: "route", eyebrow: "Hardest-hit route", headline: `Route ${rt}`, detail: `${route[1].tech ? `${route[1].tech} · ` : ""}${money0(route[1].value)} · ${route[1].count} services · ${pct(route[1].value)}`, filter: { branch: b, route: rt } });
  }
  const multiRows = rows.filter((r) => multi.has(r.account));
  if (multiRows.length) {
    const accts = new Set(multiRows.map((r) => r.account)).size;
    const v = multiRows.reduce((s, r) => s + r.lossValue, 0);
    out.push({ key: "multi", eyebrow: "Whole-account losses", headline: `${accts} account${accts === 1 ? "" : "s"}`, detail: `cancelled 2+ services · ${money0(v)} (${pct(v)})`, filter: { multi: "1" } });
  }
  if (reasonsLoaded) {
    const young = rows.filter((r) => r.tenure === "lt1");
    if (young.length) {
      const v = young.reduce((s, r) => s + r.lossValue, 0);
      out.push({ key: "young", eyebrow: "First-year cancellations", headline: `${young.length} service${young.length === 1 ? "" : "s"}`, detail: `under a year old · ${money0(v)} (${pct(v)})`, filter: { tenure: "lt1" } });
    }
  }
  if (out.length < 4) {
    const big = rows.filter((r) => r.value === "1000");
    if (big.length) {
      const v = big.reduce((s, r) => s + r.lossValue, 0);
      out.push({ key: "big", eyebrow: "Large losses", headline: `${big.length} at $1,000+`, detail: `${money0(v)} · ${pct(v)} of lost value`, filter: { value: "1000" } });
    }
  }
  return out.slice(0, 4);
}
