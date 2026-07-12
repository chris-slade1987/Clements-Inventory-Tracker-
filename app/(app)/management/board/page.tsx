import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money } from "@/lib/format";
import {
  cell,
  kpiCatalog,
  listPeriods,
  periodValues,
  priorPeriod,
  resolvePeriod,
  trend,
  type Basis,
  type Cell,
} from "@/lib/management";
import Controls from "../Controls";
import { AreaTrend, Donut } from "@/components/charts";

export const dynamic = "force-dynamic";

const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);

export default async function BoardPage({
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
        <PageHeader title="Board / Executive" subtitle="Company financials" />
        <EmptyState title="No reports uploaded yet" hint="Upload a Monthly Board Report to populate this dashboard." />
      </>
    );
  }

  const period = (await resolvePeriod(sp.p))!;
  const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const basis: Basis = sp.basis === "ytd" ? "ytd" : "month";
  const prior = await priorPeriod(period);

  const [cat, values, priorValues, bookTrend] = await Promise.all([
    kpiCatalog(),
    periodValues(period.id),
    prior ? periodValues(prior.id) : Promise.resolve(new Map<string, Cell>()),
    trend("book_value", "company", "month"),
  ]);
  const get = (kpi: string, b: Basis = basis) => cell(values, kpi, "company", b);
  const basisLabel = basis === "ytd" ? "Year to date" : period.label;

  const headline = [
    { k: "net_revenue", label: "Net Revenue" },
    { k: "ebitda", label: "EBITDA" },
    { k: "operating_income", label: "Operating Income" },
    { k: "net_income", label: "Net Income" },
    { k: "ending_cash", label: "Ending Cash" },
  ]
    .map((h) => ({ ...h, c: get(h.k), meta: cat.get(h.k) }))
    .filter((h) => h.c.actual != null);

  // AR aging slices
  const aging = [
    { key: "ar_current", label: "Current" },
    { key: "ar_30_60", label: "30–60 days" },
    { key: "ar_60_plus", label: "60+ days" },
    { key: "ar_stale", label: "Pre-2026" },
  ]
    .map((a) => ({ label: a.label, value: get(a.key, "month").actual ?? 0 }))
    .filter((a) => a.value > 0);

  const balanceRows = [
    "ending_cash", "accounts_receivable", "total_current_assets", "net_ppe", "total_assets",
    "line_of_credit", "total_current_liabilities", "total_lt_debt", "total_liabilities", "total_equity",
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Board / Executive" subtitle={`Company financials · ${period.label}${basis === "ytd" ? " · YTD" : ""}`} />
        <Controls
          periods={periods.map((p) => ({ key: `${p.year}-${String(p.month).padStart(2, "0")}`, label: p.label }))}
          period={periodKey}
          basis={basis}
          basePath="/management/board"
        />
      </div>

      {/* Financial headline */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 my-4">
        {headline.map((h) => (
          <Card key={h.k} className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted">{h.label}</div>
            <div className="mt-1 text-2xl font-light tabular-nums">{money(h.c.actual)}</div>
            {h.k === "ebitda" && get("ebitda_pct").actual != null ? (
              <div className="text-[11px] text-muted">{pct(get("ebitda_pct").actual)} margin</div>
            ) : null}
            <VarianceChip c={h.c} unit="usd" />
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* P&L */}
        <Card className="p-0 overflow-hidden lg:col-span-2">
          <PanelHead>Consolidated P&amp;L · {basisLabel}</PanelHead>
          <KpiTable values={values} cat={cat} basis={basis}
            keys={["net_revenue", "route_contrib", "sga", "operating_income", "depreciation", "amortization", "interest_expense", "management_fee", "ebitda", "ebitda_pct", "net_income"]} />
          <div className="px-4 py-2 border-t border-line text-[11px] text-muted">
            Full-year forecast:{" "}
            <span className="text-ink font-medium">EBITDA {money(get("ebitda", "cy_forecast").actual)}</span> vs {money(get("ebitda", "cy_forecast").budget)} budget
            {get("ebitda", "cy_forecast").variance != null ? (
              <span className={get("ebitda", "cy_forecast").favorable ? "text-emerald-700" : "text-red-600"}>
                {" "}({get("ebitda", "cy_forecast").variance! >= 0 ? "+" : ""}{money(get("ebitda", "cy_forecast").variance)})
              </span>
            ) : null}
          </div>
        </Card>

        {/* Balance sheet */}
        <Card className="p-0 overflow-hidden">
          <PanelHead>Balance sheet · {period.label}{prior ? ` (vs ${prior.label})` : ""}</PanelHead>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium text-right">{period.label}</th>
                  <th className="px-4 py-2 font-medium text-right">Δ MoM</th>
                </tr>
              </thead>
              <tbody>
                {balanceRows.map((k) => {
                  const meta = cat.get(k);
                  const now = cell(values, k, "company", "month").actual;
                  if (now == null) return null;
                  const was = cell(priorValues, k, "company", "month").actual;
                  const delta = was != null ? now - was : null;
                  // For liabilities/LOC, a decrease is favorable.
                  const good = delta == null ? null : (meta?.higherIsBetter ? delta >= 0 : delta <= 0);
                  return (
                    <tr key={k} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">{meta?.label ?? k}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(now)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums ${delta == null ? "text-muted" : good ? "text-emerald-700" : "text-red-600"}`}>
                        {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${money(delta)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Cash flow */}
        <Card className="p-0 overflow-hidden">
          <PanelHead>Cash flow · {basisLabel}</PanelHead>
          <KpiTable values={values} cat={cat} basis={basis} hideBudget
            keys={["cash_ops", "cash_investing", "cash_financing", "cash_net"]} />
        </Card>

        {/* AR aging */}
        <Card className="p-4">
          <PanelTitle>AR aging · {period.label}</PanelTitle>
          {aging.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No AR aging detail.</p>
          ) : (
            <div className="mt-3">
              <Donut slices={aging} centerLabel="total AR" centerValue={`$${Math.round(aging.reduce((s, a) => s + a.value, 0) / 1000)}K`} />
            </div>
          )}
        </Card>

        {/* Book value trend */}
        <Card className="p-4">
          <PanelTitle>Forward 12-mo book value</PanelTitle>
          <div className="mt-2">
            <AreaTrend points={bookTrend.map((r) => ({ label: r.label.replace(" 2026", ""), value: r.actual, budget: r.budget }))} />
          </div>
        </Card>
      </div>

      <p className="mt-4 text-xs text-muted">
        Branch-level operational detail lives in{" "}
        <Link href={`/management?p=${periodKey}`} className="text-brand-300 hover:underline">Management</Link>.
      </p>
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
function VarianceChip({ c, unit }: { c: Cell; unit: string }) {
  if (c.variance == null || c.budget == null) return <div className="mt-1 text-[11px] text-muted">no budget</div>;
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
function KpiTable({
  values, cat, basis, keys, hideBudget,
}: {
  values: Map<string, Cell>;
  cat: Map<string, { label: string; unit: string }>;
  basis: Basis;
  keys: string[];
  hideBudget?: boolean;
}) {
  const rows = keys
    .map((k) => ({ key: k, meta: cat.get(k), c: cell(values, k, "company", basis) }))
    .filter((r) => r.c.actual != null || r.c.budget != null);
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-sm text-muted">No data for this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="px-4 py-2 font-medium">Metric</th>
            <th className="px-3 py-2 font-medium text-right">Actual</th>
            {!hideBudget && <th className="px-3 py-2 font-medium text-right">Budget</th>}
            {!hideBudget && <th className="px-4 py-2 font-medium text-right">Variance</th>}
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
                {!hideBudget && <td className="px-3 py-2 text-right tabular-nums text-muted">{fmt(r.c.budget, unit)}</td>}
                {!hideBudget && (
                  <td className={`px-4 py-2 text-right tabular-nums ${r.c.variance == null ? "text-muted" : good ? "text-emerald-700" : "text-red-600"}`}>
                    {r.c.variance == null ? "—" : unit === "pct" ? `${r.c.variance >= 0 ? "+" : ""}${r.c.variance.toFixed(1)} pts` : `${r.c.variance >= 0 ? "+" : ""}${money(r.c.variance)}`}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
