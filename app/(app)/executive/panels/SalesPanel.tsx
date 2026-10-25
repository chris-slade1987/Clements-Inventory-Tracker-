import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { type SessionUser } from "@/lib/auth";
import { money } from "@/lib/format";
import {
  BRANCHES,
  branchLabel,
  cell,
  leadSources,
  listPeriods,
  periodValues,
  resolvePeriod,
  trend,
  type Basis,
  type Scope,
} from "@/lib/management";
import Controls from "@/app/(app)/management/Controls";
import { LineChart, Donut } from "@/components/charts";
import { latestSalesSnapshot } from "@/lib/sales-sync";
import { isConfigured as isWorkwaveConfigured } from "@/lib/workwave";
import SalesCenterLive from "@/app/(app)/management/sales/SalesCenterLive";
import MetricInfo from "@/components/MetricInfo";
import { hasMetric } from "@/lib/metrics-registry";

// Executive dashboard — SALES & ATTRITION tab. Live Sales Center pipeline + the
// MBR new-sales / cancellations / lead-source views. The former `/management/sales`
// dashboard, now a tab. Guarded upstream by the page (canViewExec OR canManageSales
// — the Sales Director). The Sales Team operations hub stays separate at `/sales`.
export async function SalesPanel({
  user,
  sp,
}: {
  user: SessionUser;
  sp: Record<string, string | undefined>;
}) {
  const snap = await latestSalesSnapshot();
  // Sync / data-connection controls are ADMIN-ONLY (audit C7): the manual sync and
  // connection status belong to a quiet "data connection" affordance, not an
  // everyday button on an analytics page. Everyone keeps the read-only metrics.
  const canSync = user.role === "admin";
  const workwaveConfigured = isWorkwaveConfigured();
  const live = (
    <SalesCenterLive
      metrics={snap.metrics}
      syncedAt={snap.syncedAt ? snap.syncedAt.toISOString() : null}
      lastError={snap.lastError ?? null}
      canSync={canSync}
      workwaveConfigured={workwaveConfigured}
    />
  );

  const periods = await listPeriods();
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title="Sales & Attrition" subtitle="Live Sales Center pipeline + Monthly Board Report" />
        {live}
        <EmptyState title="No board reports uploaded yet" hint="Upload a Monthly Board Report to populate the monthly attrition/revenue sections." />
      </>
    );
  }

  const period = (await resolvePeriod(sp.p))!;
  const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const basis: Basis = sp.basis === "ytd" ? "ytd" : "month";
  const scope: Scope = (BRANCHES.find((b) => b.key === sp.scope)?.key ?? "company") as Scope;
  const isCompany = scope === "company";

  const [values, sources] = await Promise.all([periodValues(period.id), leadSources(period.id, "company")]);
  const get = (kpi: string) => cell(values, kpi, scope, basis);

  // New-sales trailing matrix: branches × periods (month actuals).
  const salesByBranch = await Promise.all(
    BRANCHES.map(async (b) => ({ branch: b, series: await trend("new_sales", b.key, "month") }))
  );
  const monthCols = salesByBranch[0]?.series.map((s) => ({ label: s.label.replace(" 2026", ""), key: `${s.year}-${s.month}` })) ?? [];

  const basisLabel = basis === "ytd" ? "YTD" : period.label;
  const newSales = get("new_sales");
  const attrition = get("attrition");
  const netBook = newSales.actual != null && attrition.actual != null ? newSales.actual - attrition.actual : null;

  const branchLink = (s: string) => {
    const params = new URLSearchParams();
    params.set("tab", "sales");
    params.set("p", periodKey);
    params.set("basis", basis);
    if (s !== "company") params.set("scope", s);
    return `/executive?${params.toString()}`;
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Sales & Attrition" subtitle={`New business & cancellations · ${period.label}${basis === "ytd" ? " · YTD" : ""}`} />
        <Controls
          periods={periods.map((p) => ({ key: `${p.year}-${String(p.month).padStart(2, "0")}`, label: p.label }))}
          period={periodKey}
          basis={basis}
          basePath="/executive"
        />
      </div>

      {live}

      {/* Source + window legend (B1/C3): three different "sales" figures sit near each
          other across the sales screens — spell out what each one is and its window. */}
      <div className="mb-6 rounded-xl border border-line bg-black/[0.015] px-4 py-3 text-[11px] leading-relaxed text-muted">
        <div className="mb-1 font-semibold uppercase tracking-wide text-muted">Which number is which</div>
        <ul className="space-y-0.5">
          <li><span className="font-medium text-ink">Sales Center &ldquo;sold&rdquo;</span> (card above) = WorkWave/sheet annualized sold value, windowed MTD / QTD / YTD.</li>
          <li><span className="font-medium text-ink">New sales</span> (below) = MBR-reported new business revenue, windowed {basis === "ytd" ? "year-to-date" : "for the month"} by the period/basis toggle.</li>
          <li><span className="font-medium text-ink">Closed</span> on the <Link href="/sales" className="text-brand-700 hover:underline">Sales Team</Link> board = per-advisor funnel closes for the current sales month — a different source and window again.</li>
        </ul>
      </div>

      {/* Branch selector by new-sales */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5 mb-6 mt-2">
        <Link href={branchLink("company")} className="block">
          <Card className={`p-4 h-full transition ${isCompany ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-300"}`}>
            <div className="flex items-start gap-1">
              <span className="text-xs uppercase tracking-wider text-muted">All branches</span>
              <MetricInfo metricKey="new_sales" srHint="MBR new sales" className="-mt-0.5" />
            </div>
            <div className="mt-2 text-2xl font-light tabular-nums">{money(cell(values, "new_sales", "company", basis).actual)}</div>
            <div className="text-[11px] text-muted">MBR new sales · {basisLabel}</div>
          </Card>
        </Link>
        {BRANCHES.map((b) => {
          const ns = cell(values, "new_sales", b.key, basis);
          const sel = scope === b.key;
          return (
            <Link key={b.key} href={branchLink(sel ? "company" : b.key)} className="block">
              <Card className={`p-4 h-full overflow-hidden transition ${sel ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-300"}`}>
                <div className="h-1 -mx-4 -mt-4 mb-3 bg-emerald-grad" />
                <div className="text-xs font-medium uppercase tracking-wider text-muted">{b.label}</div>
                <div className="mt-2 text-xl font-light tabular-nums">{money(ns.actual)}</div>
                {ns.variance != null ? (
                  <div className={`text-[11px] font-medium ${ns.favorable ? "text-emerald-700" : "text-red-600"}`}>
                    {ns.variance >= 0 ? "+" : ""}{money(ns.variance)} vs target
                  </div>
                ) : <div className="text-[11px] text-muted">new sales</div>}
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
          {isCompany ? "All branches" : branchLabel(scope)}
          <span className="text-muted font-light">· {basisLabel}</span>
        </h2>
        {!isCompany ? <Link href={branchLink("company")} className="text-xs font-medium text-brand-700 hover:underline">← All branches</Link> : null}
      </div>

      {/* Headline */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Stat label="New Sales" value={money(newSales.actual)} c={newSales} unit="usd" metricKey="new_sales" />
        <Stat label="Cancellations" value={money(attrition.actual)} c={attrition} unit="usd" invertNote metricKey="attrition" />
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Net Book Change</div>
          <div className={`mt-1 text-2xl font-light tabular-nums ${netBook != null && netBook < 0 ? "text-red-600" : ""}`}>
            {netBook == null ? "—" : `${netBook >= 0 ? "+" : ""}${money(netBook)}`}
          </div>
          <div className="mt-1 text-[11px] text-muted">new sales − cancellations</div>
        </Card>
        <Stat label="Attrition Rate" value={get("attrition_rate").actual != null ? `${get("attrition_rate").actual}%` : "—"} c={get("attrition_rate")} unit="pct" metricKey="attrition_rate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* New sales by branch — trend */}
        <Card className="p-4 lg:col-span-2">
          <div className="text-sm font-medium text-ink mb-2">New sales by branch · trend</div>
          <LineChart
            xLabels={monthCols.map((m) => m.label)}
            series={salesByBranch.map((sb) => ({
              name: sb.branch.label.replace(" Beach", ""),
              points: sb.series.map((s) => s.actual),
            }))}
          />
        </Card>

        {/* New sales by branch — trailing months table */}
        <Card className="p-0 overflow-hidden lg:col-span-2">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">New sales by branch · trailing months <span className="font-normal text-muted">(MBR)</span></div>
          <div className="overflow-x-auto">
            {/* Mobile: the Branch column stays pinned left and the matrix gets a
                min-width so the month cells aren't crushed (audit A5). */}
            <table className="w-full text-sm" style={{ minWidth: `${160 + monthCols.length * 72}px` }}>
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="sticky left-0 z-10 bg-white px-4 py-2 font-medium">Branch</th>
                  {monthCols.map((m) => <th key={m.key} className="px-3 py-2 font-medium text-right">{m.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {salesByBranch.map(({ branch, series }) => (
                  <tr key={branch.key} className="border-b border-line last:border-0">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium">{branch.label}</td>
                    {series.map((s) => (
                      <td key={`${s.year}-${s.month}`} className="px-3 py-2 text-right tabular-nums">{s.actual != null ? money(s.actual) : "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Lead sources */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Lead sources · {period.label}</div>
          {sources.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No lead-source detail for this month.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="px-4 pt-4">
                <Donut
                  slices={sources.map((s) => ({ label: s.source, value: s.revenueMonth }))}
                  centerLabel="new sales"
                  centerValue={`$${Math.round(sources.reduce((a, s) => a + s.revenueMonth, 0) / 1000)}K`}
                />
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium text-right">Month</th>
                    <th className="px-3 py-2 font-medium text-right">YTD</th>
                    <th className="px-4 py-2 font-medium text-right">Close rate</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.source} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">{s.source}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(s.revenueMonth)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{s.revenueYtd != null ? money(s.revenueYtd) : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.closeRate != null ? `${s.closeRate.toFixed(0)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 py-2 border-t border-line text-[11px] text-muted">
            Close rate and sale-type detail populate once lead-level data (leads → won) is fed — not in the MBR.
          </div>
        </Card>

        {/* Cancellations by branch */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Cancellations by branch · {period.label}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium text-right">Cancellations</th>
                  <th className="px-4 py-2 font-medium text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {BRANCHES.map((b) => {
                  const a = cell(values, "attrition", b.key, "month");
                  const r = cell(values, "attrition_rate", b.key, "month");
                  if (a.actual == null && r.actual == null) return null;
                  return (
                    <tr key={b.key} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">{b.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(a.actual)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.actual != null ? `${r.actual}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function Stat({
  label, value, c, unit, invertNote, metricKey,
}: {
  label: string;
  value: string;
  c: { budget: number | null; variance: number | null; favorable: boolean | null };
  unit: string;
  invertNote?: boolean;
  metricKey?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-1">
        <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
        {hasMetric(metricKey) ? <MetricInfo metricKey={metricKey} srHint={label} className="-mt-0.5" /> : null}
      </div>
      <div className="mt-1 text-2xl font-light tabular-nums">{value}</div>
      {c.variance != null && c.budget != null ? (
        <div className="mt-1 text-[11px]">
          <span className={`font-medium ${c.favorable ? "text-emerald-700" : "text-red-600"}`}>
            {c.variance >= 0 ? "+" : ""}{unit === "pct" ? `${c.variance.toFixed(1)} pts` : money(c.variance)}
          </span>
          <span className="text-muted"> vs {unit === "pct" ? `${c.budget}%` : money(c.budget)} {invertNote ? "target" : "bdgt"}</span>
        </div>
      ) : (
        <div className="mt-1 text-[11px] text-muted">no target</div>
      )}
    </Card>
  );
}
