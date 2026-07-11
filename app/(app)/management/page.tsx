import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
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
import Controls from "./Controls";

export const dynamic = "force-dynamic";

function pctStr(n: number | null | undefined) {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

export default async function ManagementPage({
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
        <PageHeader title="Management" subtitle="Board & management KPIs" />
        <EmptyState
          title="No reports uploaded yet"
          hint="Upload a Monthly Board Report (MBR) to populate the dashboard."
        />
        <div className="mt-4">
          <Link href="/management/upload" className="text-sm font-medium text-brand-300 hover:underline">
            → Upload your first MBR
          </Link>
        </div>
      </>
    );
  }

  const period = (await resolvePeriod(sp.p))!;
  const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const basis: Basis = sp.basis === "ytd" ? "ytd" : "month";
  const scope: Scope = (BRANCHES.find((b) => b.key === sp.scope)?.key ?? "company") as Scope;
  const isCompany = scope === "company";

  const [cat, values, lob, techs] = await Promise.all([
    kpiCatalog(),
    periodValues(period.id),
    lobRevenue(period.id, scope),
    isCompany ? Promise.resolve([]) : techProduction(period.id, scope),
  ]);
  const bookTrend = await trend("book_value", "company", "month");

  const get = (kpi: string) => cell(values, kpi, scope, basis);
  const basisLabel = basis === "ytd" ? "YTD" : period.label;

  // Headline KPIs, scope-aware; only those with an actual value are shown.
  const headlineKeys = isCompany
    ? ["net_revenue", "operating_income", "ebitda_pct", "route_contrib_pct", "ending_cash"]
    : ["production", "route_contrib", "route_contrib_pct", "new_sales", "attrition"];
  const headline = headlineKeys
    .map((k) => ({ key: k, meta: cat.get(k), c: get(k) }))
    .filter((h) => h.c.actual != null);

  const branchLink = (s: string) => {
    const params = new URLSearchParams();
    params.set("p", periodKey);
    params.set("basis", basis);
    if (s !== "company") params.set("scope", s);
    return `/management?${params.toString()}`;
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Management"
          subtitle={`Budget vs actual · ${period.label}${basis === "ytd" ? " · YTD" : ""}`}
        />
        <Controls
          periods={periods.map((p) => ({ key: `${p.year}-${String(p.month).padStart(2, "0")}`, label: p.label }))}
          period={periodKey}
          basis={basis}
        />
      </div>

      {/* Branch selector — company banner + branch cards (production scorecard) */}
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

      {/* Scope indicator */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-white">
          <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
          {isCompany ? "All branches" : branchLabel(scope)}
          <span className="text-mint font-light">· {basisLabel}</span>
        </h2>
        {!isCompany ? (
          <Link href={branchLink("company")} className="text-xs font-medium text-brand-300 hover:underline">
            ← All branches
          </Link>
        ) : null}
      </div>

      {/* Headline KPI strip */}
      {headline.length > 0 ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-5">
          {headline.map((h) => (
            <Card key={h.key} className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted">{h.meta?.label ?? h.key}</div>
              <div className="mt-1 text-2xl font-light tabular-nums">
                {h.meta?.unit === "pct" ? pctStr(h.c.actual) : money(h.c.actual)}
              </div>
              <VarianceChip c={h.c} unit={h.meta?.unit ?? "usd"} />
            </Card>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Financial summary (P&L) */}
        <Card className="p-0 overflow-hidden">
          <PanelHead>Financial summary · {basisLabel}</PanelHead>
          <KpiTable
            values={values} cat={cat} scope={scope} basis={basis}
            keys={["net_revenue", "route_contrib", "route_contrib_pct", "sga", "operating_income", "ebitda", "ebitda_pct", "net_income"]}
          />
        </Card>

        {/* Route contribution detail */}
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

        {/* New sales & attrition — summary; full detail on its own dashboard */}
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

        {/* Forward book value trend */}
        <Card className="p-4">
          <PanelTitle>Forward 12-mo book value</PanelTitle>
          <TrendBars rows={bookTrend} />
        </Card>

        {/* Revenue by line of business */}
        <Card className="p-4 lg:col-span-2">
          <PanelTitle>Revenue by line of business · {period.label}</PanelTitle>
          {lob.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No line-of-business detail for this scope.</p>
          ) : (
            <LobBars rows={lob} />
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
function PanelHead({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">{children}</div>;
}

function fmt(v: number | null, unit: string) {
  if (v == null) return "—";
  return unit === "pct" ? `${v.toFixed(1)}%` : money(v);
}

// A compact favorable/unfavorable variance chip.
function VarianceChip({ c, unit }: { c: Cell; unit: string }) {
  if (c.variance == null || c.budget == null) {
    return <div className="mt-1 text-[11px] text-muted">no budget</div>;
  }
  const good = c.favorable === true;
  const sign = c.variance >= 0 ? "+" : "";
  const val = unit === "pct" ? `${sign}${c.variance.toFixed(1)} pts` : `${sign}${money(c.variance)}`;
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px]">
      <span className={`font-medium ${good ? "text-emerald-700" : "text-red-600"}`}>{val}</span>
      <span className="text-muted">vs {fmt(c.budget, unit)} bdgt</span>
    </div>
  );
}

function BudgetLine({ c, unit, big }: { c: Cell; unit: string; big?: boolean }) {
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

function TrendBars({ rows }: { rows: { label: string; actual: number | null }[] }) {
  const vals = rows.map((r) => r.actual ?? 0);
  const max = Math.max(1, ...vals);
  const min = Math.min(...vals.filter((v) => v > 0), max);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">No trend data.</p>;
  return (
    <div className="mt-3 flex items-end gap-2 h-40">
      {rows.map((r) => {
        const v = r.actual ?? 0;
        // Scale within [min*0.95, max] so month-to-month change is visible.
        const h = max > min ? 15 + ((v - min * 0.95) / (max - min * 0.95)) * 80 : 60;
        return (
          <div key={r.label} className="flex-1 flex flex-col items-center justify-end gap-1">
            <div className="text-[10px] tabular-nums text-ink">{v >= 1000 ? `$${(v / 1_000_000).toFixed(2)}M` : "—"}</div>
            <div className="w-full rounded-t bg-emerald-grad" style={{ height: `${Math.max(6, h)}%` }} />
            <div className="text-[10px] text-muted">{r.label.replace(" 2026", "")}</div>
          </div>
        );
      })}
    </div>
  );
}

function LobBars({ rows }: { rows: { lob: string; revenue: number }[] }) {
  const total = rows.reduce((s, r) => s + r.revenue, 0) || 1;
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <div className="mt-3 space-y-2.5">
      {rows.map((r) => (
        <div key={r.lob} className="flex items-center gap-3">
          <div className="w-24 shrink-0 text-sm truncate">{r.lob}</div>
          <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden">
            <div className="h-full rounded bg-emerald-grad" style={{ width: `${Math.max(3, (r.revenue / max) * 100)}%` }} />
          </div>
          <div className="w-28 shrink-0 text-right text-sm tabular-nums">
            <span className="font-medium">{money(r.revenue)}</span>
            <span className="text-muted"> · {Math.round((r.revenue / total) * 100)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}
