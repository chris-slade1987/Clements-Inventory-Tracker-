import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
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
import Controls from "../Controls";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;

  const periods = await listPeriods();
  if (periods.length === 0) {
    return (
      <>
        <PageHeader title="Sales & Attrition" subtitle="New business and cancellations" />
        <EmptyState title="No reports uploaded yet" hint="Upload a Monthly Board Report to populate this dashboard." />
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
    params.set("p", periodKey);
    params.set("basis", basis);
    if (s !== "company") params.set("scope", s);
    return `/management/sales?${params.toString()}`;
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Sales & Attrition" subtitle={`New business & cancellations · ${period.label}${basis === "ytd" ? " · YTD" : ""}`} />
        <Controls
          periods={periods.map((p) => ({ key: `${p.year}-${String(p.month).padStart(2, "0")}`, label: p.label }))}
          period={periodKey}
          basis={basis}
          basePath="/management/sales"
        />
      </div>

      {/* Branch selector by new-sales */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5 mb-6 mt-2">
        <Link href={branchLink("company")} className="block">
          <Card className={`p-4 h-full transition ${isCompany ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-300"}`}>
            <div className="text-xs uppercase tracking-wider text-muted">All branches</div>
            <div className="mt-2 text-2xl font-light tabular-nums">{money(cell(values, "new_sales", "company", basis).actual)}</div>
            <div className="text-[11px] text-muted">new sales · {basisLabel}</div>
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
        <h2 className="flex items-center gap-2 text-sm font-medium text-white">
          <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
          {isCompany ? "All branches" : branchLabel(scope)}
          <span className="text-mint font-light">· {basisLabel}</span>
        </h2>
        {!isCompany ? <Link href={branchLink("company")} className="text-xs font-medium text-brand-300 hover:underline">← All branches</Link> : null}
      </div>

      {/* Headline */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Stat label="New Sales" value={money(newSales.actual)} c={newSales} unit="usd" />
        <Stat label="Cancellations" value={money(attrition.actual)} c={attrition} unit="usd" invertNote />
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Net Book Change</div>
          <div className={`mt-1 text-2xl font-light tabular-nums ${netBook != null && netBook < 0 ? "text-red-600" : ""}`}>
            {netBook == null ? "—" : `${netBook >= 0 ? "+" : ""}${money(netBook)}`}
          </div>
          <div className="mt-1 text-[11px] text-muted">new sales − cancellations</div>
        </Card>
        <Stat label="Attrition Rate" value={get("attrition_rate").actual != null ? `${get("attrition_rate").actual}%` : "—"} c={get("attrition_rate")} unit="pct" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* New sales by branch — trailing months */}
        <Card className="p-0 overflow-hidden lg:col-span-2">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">New sales by branch · trailing months</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Branch</th>
                  {monthCols.map((m) => <th key={m.key} className="px-3 py-2 font-medium text-right">{m.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {salesByBranch.map(({ branch, series }) => (
                  <tr key={branch.key} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">{branch.label}</td>
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
  label, value, c, unit, invertNote,
}: {
  label: string;
  value: string;
  c: { budget: number | null; variance: number | null; favorable: boolean | null };
  unit: string;
  invertNote?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
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
