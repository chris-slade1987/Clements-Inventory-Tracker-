import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, branchLocked, canViewExec } from "@/lib/auth";
import { money } from "@/lib/format";
import {
  BRANCHES,
  branchLabel,
  cell,
  kpiCatalog,
  listPeriods,
  lobRevenue,
  periodValues,
  resolvePeriod,
  techProduction,
  trend,
  type Basis,
  type Cell,
  type Scope,
} from "@/lib/management";
import Controls from "@/app/(app)/management/Controls";
import { Waterfall, GroupedBars, Donut, AreaTrend, BudgetVsForecast } from "@/components/charts";
import { branchKpiMonthly, BRANCH_KPI_LABEL, BRANCH_KPI_KEYS } from "@/lib/branch-kpis";
import { buildBranchPnlPayload } from "@/lib/branch-pnl";
import BranchPnlClient from "@/app/(app)/management/branch-pnl/BranchPnlClient";
import KpiSummaryButton from "@/components/KpiSummaryButton";
import InsightsLink from "@/components/InsightsLink";
import { KpiTile, VarianceChip } from "@/components/kpi-tiles";
import MetricInfo from "@/components/MetricInfo";
import { hasMetric } from "@/lib/metrics-registry";
import { collectAttention } from "@/lib/needs-attention";
import { buildExecutiveRhythm } from "@/lib/rhythm";
import RhythmRibbon from "@/components/RhythmRibbon";
import NeedsAttentionList from "@/components/NeedsAttentionList";

type Unit = "usd" | "pct" | "count";

export const dynamic = "force-dynamic";

function pctStr(n: number | null | undefined) {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

export default async function ManagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  // Executive — OPERATING. This is the leadership operating read: company & branch
  // budget-vs-actual (headline KPIs, route-contribution, per-branch production, the
  // branch P&L, FY-forecast lines). It is NOT the financial statements — the full
  // P&L, balance sheet and cash flow live on the Board dashboard (/management/board).
  // Admin / senior-leadership / board only; everyone else (branch managers, Sales
  // Director) uses the operating Company KPIs at /management. Non-exec hits bounce there.
  if (!canViewExec(user)) {
    redirect("/management");
  }
  const sp = await searchParams;

  const periods = await listPeriods();
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title="Executive — Operating" subtitle="Company & branch budget vs actual" />
        <EmptyState
          title="No reports uploaded yet"
          hint="Upload a Monthly Board Report (MBR) to populate the dashboard."
        />
        <div className="mt-4 flex flex-wrap gap-4">
          <Link href="/management/upload" className="text-sm font-medium text-brand-700 hover:underline">
            → Upload your first MBR
          </Link>
          <Link href="/management/board" className="text-sm font-medium text-brand-700 hover:underline">
            Full financial statements →
          </Link>
        </div>
      </>
    );
  }

  const period = (await resolvePeriod(sp.p))!;
  const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const basis: Basis = sp.basis === "ytd" ? "ytd" : "month";
  const locked = branchLocked(user);
  // Insights (grounded AI Q&A) is admin + senior-leadership only (board observers excluded).
  const canInsights = user.role === "admin" || user.seniorLeadership;
  const requestedScope = sp.scope === "company" ? "company" : (BRANCHES.find((b) => b.key === sp.scope)?.key ?? null);
  // Branch-locked managers DEFAULT to their own branch, but may toggle to the
  // company or a peer branch for comparison (leadership approved this). Admins/exec
  // default to company.
  const scope: Scope = (requestedScope ?? (locked ? (user.branch ?? "company") : "company")) as Scope;
  const isCompany = scope === "company";

  const [cat, values, lob, techs] = await Promise.all([
    kpiCatalog(),
    periodValues(period.id),
    lobRevenue(period.id, scope),
    isCompany ? Promise.resolve([]) : techProduction(period.id, scope),
  ]);
  const bookTrend = await trend("book_value", "company", "month");

  // Branch scope: the full Branch P&L (budget-vs-actual tiles / charts / table +
  // book growth) is now rendered inline here, consolidating the former separate
  // /management/branch-pnl page into one branch view.
  const branchPnl = !isCompany ? await buildBranchPnlPayload(values, scope, locked, { year: period.year, month: period.month }) : null;

  // Monthly budget-vs-actual + forward-forecast series for the three headline
  // branch categories (company = Σ branches), from the 2026 Branch KPIs workbook.
  const kpiForecasts = isCompany
    ? await Promise.all(BRANCH_KPI_KEYS.map((k) => branchKpiMonthly("company", period.year, k)))
    : [];

  const get = (kpi: string) => cell(values, kpi, scope, basis);
  const basisLabel = basis === "ytd" ? "YTD" : period.label;

  // Leadership "what needs me" lead + operating-rhythm ribbon (previously MISSING
  // on the executive center). Built from the unified needs-attention model; the
  // ribbon reads its cadence straight off those items so it can't drift.
  const now = new Date();
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const execAttention = await collectAttention({ user, audience: "executive", now });
  const renewalKinds = new Set(["policy_renewal", "license_expiring", "lease_expiring"]);
  const findCount = (kind: string) => execAttention.filter((a) => a.kind === kind).reduce((s, a) => s + (a.count ?? 1), 0);
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const execRhythm = buildExecutiveRhythm({
    now, quarter,
    overdueFollowUps: findCount("audit_followup"),
    missedChecklists: findCount("checklist_miss"),
    mbrMissing: execAttention.some((a) => a.kind === "mbr_missing"),
    mbrMonthLabel: lastMonthDate.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
    warehouseMissing: findCount("warehouse_due"),
    warehouseTotal: BRANCHES.length,
    auditsMissing: findCount("audit_missing"),
    auditsTotal: BRANCHES.length,
    renewals: execAttention.filter((a) => renewalKinds.has(a.kind)).length,
  });

  // Headline KPIs, scope-aware; only those with an actual value are shown.
  const headlineKeys = isCompany
    ? ["net_revenue", "production", "route_contrib_pct", "new_sales", "attrition"]
    : ["production", "route_contrib", "route_contrib_pct", "new_sales", "attrition"];
  const headline = headlineKeys
    .map((k) => ({ key: k, meta: cat.get(k), c: get(k) }))
    .filter((h) => h.c.actual != null);

  // Route-contribution waterfall: Net Revenue → shown route costs → a reconciling
  // "Other route costs" bucket → Route Contribution. The bucket keeps the chart
  // balanced without ever isolating manager compensation.
  const netRev = get("net_revenue").actual;
  const rc = get("route_contrib").actual;
  const costKeys = ["tech_wages", "fuel", "chemical_expense", "vehicle_rm"];
  const shownCosts = costKeys
    .map((k) => ({ label: cat.get(k)?.label ?? k, v: get(k).actual }))
    .filter((c): c is { label: string; v: number } => c.v != null && c.v > 0);
  let waterfall: { label: string; value: number; kind: "total" | "decrease" }[] | null = null;
  if (netRev != null && rc != null && shownCosts.length > 0) {
    const other = netRev - shownCosts.reduce((s, c) => s + c.v, 0) - rc;
    waterfall = [
      { label: "Net Revenue", value: netRev, kind: "total" },
      ...shownCosts.map((c) => ({ label: c.label, value: c.v, kind: "decrease" as const })),
      ...(other > 0 ? [{ label: "Other route costs", value: other, kind: "decrease" as const }] : []),
      { label: "Route Contrib", value: rc, kind: "total" as const },
    ];
  }

  // Branch production actual vs budget (company view only).
  const prodGroups = BRANCHES.map((b) => {
    const c = cell(values, "production", b.key, basis);
    return { label: b.label.replace(" Beach", ""), actual: c.actual ?? 0, budget: c.budget };
  }).filter((g) => g.actual > 0);

  const branchLink = (s: string) => {
    const params = new URLSearchParams();
    params.set("p", periodKey);
    params.set("basis", basis);
    if (s !== "company") params.set("scope", s);
    return `/executive?${params.toString()}`;
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Executive — Operating"
          subtitle={`Company & branch budget vs actual · ${period.label}${basis === "ytd" ? " · YTD" : ""}`}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {canInsights ? <InsightsLink /> : null}
              <Link href="/management/benchmarking" className="text-sm font-medium text-brand-700 hover:underline">
                Benchmarking →
              </Link>
              <Link href={branchLink(BRANCHES[0].key)} className="text-sm font-medium text-brand-700 hover:underline">
                Branch detail →
              </Link>
              <Link href="/management/board" className="text-sm font-medium text-brand-700 hover:underline">
                Full financial statements →
              </Link>
            </div>
          }
        />
        <Controls
          periods={periods.map((p) => ({ key: `${p.year}-${String(p.month).padStart(2, "0")}`, label: p.label }))}
          period={periodKey}
          basis={basis}
        />
      </div>

      {/* Scope-aware AI read-out — company when viewing all branches, else the
          selected branch. Tailored to exactly what's on screen. */}
      <KpiSummaryButton scope={isCompany ? "company" : scope} p={periodKey} basis={basis} label={isCompany ? "AI company summary" : "AI branch summary"} />

      <div className="mt-4">
        <RhythmRibbon segments={execRhythm} />
        <NeedsAttentionList
          items={execAttention}
          title="Needs your attention"
          showBranch
          emptyText="Every branch is current — audits in, inspections logged, renewals clear."
          className="mb-6"
        />
      </div>

      {/* Branch-locked managers default to their own branch; a toggle reveals the
          company / peer-branch comparison view. Admins & exec always see the selector. */}
      {locked && user.branch ? (
        <div className="mb-4 mt-2 flex w-fit gap-1 rounded-xl bg-black/[0.06] p-1">
          <Link href={branchLink(user.branch)} className={`rounded-lg px-4 py-2 text-sm ${!isCompany ? "bg-surface text-ink font-medium shadow-sm" : "text-muted"}`}>My branch</Link>
          <Link href={branchLink("company")} className={`rounded-lg px-4 py-2 text-sm ${isCompany ? "bg-surface text-ink font-medium shadow-sm" : "text-muted"}`}>All branches</Link>
        </div>
      ) : null}

      {/* Company net-revenue banner + per-branch production cards. A branch-locked
          manager sees these only after toggling to the All-branches view. */}
      {(!locked || isCompany) ? (
        <>
          <Link href={branchLink("company")} className="block mb-4 mt-2">
            <Card className={`p-4 transition ${isCompany ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-300"}`}>
              <div className="text-xs uppercase tracking-wider text-muted">All branches · Net revenue ({basisLabel})</div>
              <BudgetLine c={cell(values, "net_revenue", "company", basis)} unit="usd" big />
            </Card>
          </Link>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
            {BRANCHES.map((b) => {
              const prod = cell(values, "production", b.key, basis);
              const sel = scope === b.key;
              return (
                <Link key={b.key} href={branchLink(sel ? "company" : b.key)} className="block">
                  <Card className={`p-4 overflow-hidden transition ${sel ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-300"}`}>
                    <div className="h-1 -mx-4 -mt-4 mb-3 bg-emerald-grad" />
                    <div className="text-xs font-medium uppercase tracking-wider text-muted">{b.label}</div>
                    <div className="mt-2 text-2xl font-light tabular-nums">{money(prod.actual)}</div>
                    <div className="text-[11px] text-muted">production</div>
                    <VarianceChip c={prod} unit="usd" />
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      {/* Budget vs actual tiles — companywide, honoring the Month/YTD toggle,
          with an FY-forecast line per category from the model's CY forecast. */}
      {isCompany ? (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
              <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
              Budget vs actual · company · {basisLabel}
            </h2>
            <Link href={branchLink(BRANCHES[0].key)} className="text-xs font-medium text-brand-700 hover:underline">
              By branch →
            </Link>
          </div>
          <CompanyBudgetTiles values={values} basis={basis} />
        </section>
      ) : null}

      {/* Monthly budget vs actual with forward forecast — the three headline
          branch categories, styled like the exec book-forecast chart. */}
      {isCompany && kpiForecasts.length > 0 ? (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
              <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
              Monthly budget vs actual · forecast to year-end
            </h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {BRANCH_KPI_KEYS.map((k, i) => (
              <Card key={k} className="p-4">
                <PanelTitle>{BRANCH_KPI_LABEL[k]}</PanelTitle>
                <div className="mt-2">
                  <BudgetVsForecast points={kpiForecasts[i].map((p) => ({ label: p.label, target: p.target, actual: p.actual }))} />
                </div>
              </Card>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Solid line = posted actuals; dashed = budgeted targets for the remaining months (2026 Branch KPIs). Company = sum of the four branches.
          </p>
        </section>
      ) : null}

      {/* Scope indicator */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
          {isCompany ? "All branches" : branchLabel(scope)}
          <span className="text-muted font-light">· {basisLabel}</span>
        </h2>
        {!isCompany ? (
          <Link href={branchLink("company")} className="text-xs font-medium text-brand-700 hover:underline">
            ← All branches
          </Link>
        ) : null}
      </div>

      {/* Branch P&L — budget vs actual (consolidated from the former Branch P&L page) */}
      {branchPnl ? (
        <div className="mb-6">
          <BranchPnlClient payload={branchPnl} />
        </div>
      ) : null}

      {/* Headline KPI strip */}
      {headline.length > 0 ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-6 mb-5">
          {headline.map((h) => (
            <Card key={h.key} className="p-4">
              <div className="flex items-start gap-1">
                <span className="text-xs uppercase tracking-wider text-muted">{h.meta?.label ?? h.key}</span>
                {hasMetric(h.key) ? <MetricInfo metricKey={h.key} srHint={h.meta?.label ?? h.key} className="-mt-0.5" /> : null}
              </div>
              <div className="mt-1 text-2xl font-light tabular-nums">
                {h.meta?.unit === "pct" ? pctStr(h.c.actual) : money(h.c.actual)}
              </div>
              <VarianceChip c={h.c} unit={(h.meta?.unit ?? "usd") as Unit} />
            </Card>
          ))}
          <AttritionRateTile c={get("attrition_rate")} isMonth={basis === "month"} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Route contribution waterfall */}
        {waterfall ? (
          <Card className="p-4 lg:col-span-2">
            <PanelTitle>Where the margin goes · route contribution · {basisLabel}</PanelTitle>
            <Waterfall steps={waterfall} />
          </Card>
        ) : null}

        {/* Branch production actual vs budget (company view) */}
        {isCompany && prodGroups.length > 0 ? (
          <Card className="p-4 lg:col-span-2">
            <PanelTitle>Production vs budget by branch · {basisLabel}</PanelTitle>
            <GroupedBars groups={prodGroups} />
          </Card>
        ) : null}

        {/* Route contribution detail — company view only (the branch P&L above
            already covers tech wages / fuel / chemical for a branch). */}
        {isCompany ? (
          <Card className="p-0 overflow-hidden">
            <PanelHead>Route contribution · {basisLabel}</PanelHead>
            <KpiTable
              values={values} cat={cat} scope={scope} basis={basis}
              keys={["tech_wages", "fuel", "chemical_expense", "vehicle_rm", "route_contrib", "route_contrib_pct"]}
            />
            {get("chemical_expense").actual != null ? (
              <div className="px-4 py-2 border-t border-line text-[11px] text-muted">
                Chemical expense ties to inventory purchases —{" "}
                <Link href="/dashboard" className="text-brand-700 hover:underline">see inventory spend</Link>.
              </div>
            ) : null}
          </Card>
        ) : null}

        {/* New sales & attrition — company view only (branch new-sales + attrition
            are already on the branch P&L / headline above). */}
        {isCompany ? (
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <span className="text-sm font-medium text-ink">New sales & attrition · {basisLabel}</span>
              <Link href={`/management/sales?p=${periodKey}&basis=${basis}`} className="text-xs font-medium text-brand-700 hover:underline">
                Full detail →
              </Link>
            </div>
            <KpiTable
              values={values} cat={cat} scope={scope} basis={basis}
              keys={["new_sales", "attrition", "attrition_rate"]}
            />
          </Card>
        ) : null}

        {/* Forward book value trend — company-level metric; company view only. */}
        {isCompany ? (
          <Card className="p-4">
            <PanelTitle>Forward 12-mo book value</PanelTitle>
            <div className="mt-2">
              <AreaTrend points={bookTrend.map((r) => ({ label: r.label.replace(" 2026", ""), value: r.actual, budget: r.budget }))} />
            </div>
          </Card>
        ) : null}

        {/* Revenue by line of business */}
        <Card className="p-4 lg:col-span-2">
          <PanelTitle>Revenue by line of business · {period.label}</PanelTitle>
          {lob.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No line-of-business detail for this scope.</p>
          ) : (
            <div className="mt-3">
              <Donut
                slices={lob.map((r) => ({ label: r.lob, value: r.revenue }))}
                centerLabel="total"
                centerValue={`$${Math.round(lob.reduce((s, r) => s + r.revenue, 0) / 1000)}K`}
              />
            </div>
          )}
        </Card>

        {/* Technician production drill-down (branch scope, production only) */}
        {!isCompany && techs.length > 0 ? (
          <Card className="p-0 overflow-hidden lg:col-span-2">
            <PanelHead>Technician production · {branchLabel(scope)} · {period.label}</PanelHead>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Technician</th>
                    <th className="px-3 py-2 font-medium">Line</th>
                    <th className="px-3 py-2 font-medium text-right">Actual</th>
                    <th className="px-3 py-2 font-medium text-right">Budget</th>
                    <th className="px-4 py-2 font-medium text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {techs.map((t) => (
                    <tr key={t.name} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">{t.name}</td>
                      <td className="px-3 py-2 text-muted">{t.lob ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(t.actual)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{money(t.budget)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums font-medium ${t.variance >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                        {t.variance >= 0 ? "+" : ""}{money(t.variance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-ink">{children}</h3>;
}

// Companywide budget-vs-actual tiles. Revenue lines are higher-is-better; cost
// lines are lower-is-better and show their % of net revenue. Each tile carries
// the current-basis actual, a favorable/unfavorable variance chip, an
// actual-vs-budget fill bar (budget tick), and the model's full-year forecast.
const BVA_TILES: { key: string; label: string; kind: "rev" | "cost" }[] = [
  { key: "net_revenue", label: "Net Revenue", kind: "rev" },
  { key: "production", label: "Production", kind: "rev" },
  { key: "route_contrib", label: "Route Contribution", kind: "rev" },
  { key: "ebitda", label: "EBITDA", kind: "rev" },
  { key: "new_sales", label: "New Sales", kind: "rev" },
  { key: "tech_wages", label: "Technician Wages", kind: "cost" },
  { key: "chemical_expense", label: "Chemical Expense", kind: "cost" },
  { key: "fuel", label: "Fuel", kind: "cost" },
  { key: "sga", label: "SG&A", kind: "cost" },
];

function CompanyBudgetTiles({ values, basis }: { values: Map<string, Cell>; basis: Basis }) {
  const revActual = cell(values, "net_revenue", "company", basis).actual;
  const tiles = BVA_TILES.map((t) => ({
    ...t,
    cur: cell(values, t.key, "company", basis),
    fc: cell(values, t.key, "company", "cy_forecast"),
  })).filter((t) => t.cur.actual != null || t.cur.budget != null);
  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {tiles.map((t) => (
        <KpiTile
          key={t.key}
          label={t.label}
          metricKey={t.key}
          c={t.cur}
          unit="usd"
          pctOfRev={t.kind === "cost" && t.cur.actual != null && revActual ? (t.cur.actual / revActual) * 100 : null}
          footer={t.fc.actual != null ? (
            <div className="mt-2 border-t border-line pt-2 text-[11px] text-muted">
              FY forecast <span className="tabular-nums text-ink">{money(t.fc.actual)}</span>
              {t.fc.budget != null ? (
                <>
                  {" "}vs {money(t.fc.budget)} bdgt{" "}
                  <span className={`tabular-nums ${t.fc.favorable ? "text-emerald-700" : "text-red-600"}`}>
                    {t.fc.variance != null ? `(${t.fc.variance >= 0 ? "+" : ""}${money(t.fc.variance)})` : ""}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
        />
      ))}
    </div>
  );
}

function PanelHead({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">{children}</div>;
}
// Monthly attrition as a % of the forward recurring book. Best-in-class is losing
// under 1% of book per month (green); above that is flagged red. On YTD it's the
// cumulative cancellations rate, so the monthly benchmark isn't applied.
function AttritionRateTile({ c, isMonth }: { c: Cell; isMonth: boolean }) {
  const v = c.actual;
  if (v == null) return null;
  const tone = isMonth ? (v < 1 ? "text-emerald-700" : "text-red-600") : "text-ink";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">Attrition Rate</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${tone}`}>{v.toFixed(2)}%</div>
      <div className="text-[11px] text-muted">{isMonth ? "of book / mo · <1% best-in-class" : "YTD cancellations rate"}</div>
    </Card>
  );
}

function fmt(v: number | null, unit: string) {
  if (v == null) return "—";
  return unit === "pct" ? `${v.toFixed(1)}%` : money(v);
}

function BudgetLine({ c, unit, big }: { c: Cell; unit: Unit; big?: boolean }) {
  return (
    <div>
      <div className={`${big ? "text-3xl" : "text-2xl"} font-light tabular-nums mt-1`}>{fmt(c.actual, unit)}</div>
      <VarianceChip c={c} unit={unit} />
    </div>
  );
}

// KPI rows: actual | budget | variance, for a fixed scope/basis.
function KpiTable({
  values, cat, scope, basis, keys,
}: {
  values: Map<string, Cell>;
  cat: Map<string, { label: string; unit: string }>;
  scope: Scope;
  basis: Basis;
  keys: string[];
}) {
  const rows = keys
    .map((k) => ({ key: k, meta: cat.get(k), c: cell(values, k, scope, basis) }))
    .filter((r) => r.c.actual != null || r.c.budget != null);
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted">No data for this scope.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="px-4 py-2 font-medium">Metric</th>
            <th className="px-3 py-2 font-medium text-right">Actual</th>
            <th className="px-3 py-2 font-medium text-right">Budget</th>
            <th className="px-4 py-2 font-medium text-right">Variance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const unit = r.meta?.unit ?? "usd";
            const good = r.c.favorable === true;
            return (
              <tr key={r.key} className="border-b border-line last:border-0">
                <td className="px-4 py-2">{r.meta?.label ?? r.key}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(r.c.actual, unit)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{fmt(r.c.budget, unit)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${r.c.variance == null ? "text-muted" : good ? "text-emerald-700" : "text-red-600"}`}>
                  {r.c.variance == null ? "—" : (unit === "pct" ? `${r.c.variance >= 0 ? "+" : ""}${r.c.variance.toFixed(1)} pts` : `${r.c.variance >= 0 ? "+" : ""}${money(r.c.variance)}`)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


