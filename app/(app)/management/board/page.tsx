import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/format";
import {
  cell,
  kpiCatalog,
  listPeriods,
  periodValues,
  priorPeriod,
  resolvePeriod,
  trend,
  BRANCHES,
  type Basis,
  type Cell,
} from "@/lib/management";
import Controls from "../Controls";
import { AreaTrend, Donut, Waterfall } from "@/components/charts";

export const dynamic = "force-dynamic";

const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);

// SG&A line-item detail, in P&L statement order. Overhead compensation appears
// only as aggregate buckets (Total Back-Office, Total Officer) — no individual
// or manager compensation line exists.
const SGA_DETAIL_KEYS = [
  "back_office_total", "officer_total", "advertising", "bankcard_fees",
  "supplies_shop", "postage", "professional_fees", "software", "insurance_general",
  "non_tech_vehicle_insurance", "employer_401_contrib", "office_expense",
  "rent_property_tax", "repairs_maint_office", "rent_vacant_lot", "telephone",
  "utilities", "bank_charges", "contributions", "dues_subscriptions",
  "education_seminars", "equipment_rental", "entertainment_meals", "payroll_fees",
  "misc_sga", "travel", "uniforms", "other_cell_phones",
];

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

  const [cat, values, priorValues, bookTrend, activeTechCount] = await Promise.all([
    kpiCatalog(),
    periodValues(period.id),
    prior ? periodValues(prior.id) : Promise.resolve(new Map<string, Cell>()),
    trend("book_value", "company", "month"),
    prisma.technician.count({ where: { active: true } }),
  ]);
  const get = (kpi: string, b: Basis = basis) => cell(values, kpi, "company", b);
  const basisLabel = basis === "ytd" ? "Year to date" : period.label;

  // ---- Capital & efficiency (point-in-time, month-end balance sheet) --------
  const monthsElapsed = period.month;
  const ltDebt = get("total_lt_debt", "month").actual;
  const loc = get("line_of_credit", "month").actual;
  const cash = get("ending_cash", "month").actual;
  const netDebt = ltDebt != null && loc != null && cash != null ? ltDebt + loc - cash : null;

  const cyEbitda = get("ebitda", "cy_forecast").actual;
  const ytdEbitda = get("ebitda", "ytd").actual;
  let leverage: number | null = null;
  let leverageDef = "Net Debt ÷ forward EBITDA";
  if (netDebt != null && cyEbitda != null && cyEbitda !== 0) {
    leverage = netDebt / cyEbitda;
    leverageDef = "× vs CY-forecast EBITDA";
  } else if (netDebt != null && ytdEbitda != null && monthsElapsed > 0) {
    const annualized = (ytdEbitda * 12) / monthsElapsed;
    if (annualized !== 0) {
      leverage = netDebt / annualized;
      leverageDef = "× vs annualized YTD EBITDA";
    }
  }

  const tca = get("total_current_assets", "month").actual;
  const tcl = get("total_current_liabilities", "month").actual;
  const ar = get("accounts_receivable", "month").actual;
  const revMonth = get("net_revenue", "month").actual;
  const revYtd = get("net_revenue", "ytd").actual;
  const workingCapital = tca != null && tcl != null ? tca - tcl : null;
  const currentRatio = tca != null && tcl != null && tcl !== 0 ? tca / tcl : null;
  const dso = ar != null && revMonth != null && revMonth !== 0 ? (ar / revMonth) * 30.4 : null;
  const revPerTech =
    revYtd != null && monthsElapsed > 0 && activeTechCount > 0 ? (revYtd * 12) / monthsElapsed / activeTechCount : null;

  const ratios = [
    { label: "Net Debt", value: netDebt == null ? "—" : money(netDebt), def: "LT debt + line of credit − ending cash" },
    { label: "Net Debt / EBITDA", value: leverage == null ? "—" : `${leverage.toFixed(2)}×`, def: leverageDef },
    { label: "Working capital", value: workingCapital == null ? "—" : money(workingCapital), def: "Current assets − current liabilities" },
    { label: "Current ratio", value: currentRatio == null ? "—" : `${currentRatio.toFixed(2)}x`, def: "Current assets ÷ current liabilities" },
    { label: "DSO", value: dso == null ? "—" : `${dso.toFixed(1)} days`, def: "AR ÷ monthly revenue × 30.4" },
    { label: "Revenue / technician", value: revPerTech == null ? "—" : money(revPerTech), def: `Annualized YTD revenue ÷ ${activeTechCount} active techs` },
  ];

  // ---- Profitability --------------------------------------------------------
  const ebitdaSel = get("ebitda", basis).actual;
  const ebitdaPctSel = get("ebitda_pct", basis).actual;
  const firstBook = bookTrend.length ? bookTrend[0].actual : null;
  const latestBook = bookTrend.length ? bookTrend[bookTrend.length - 1].actual : null;
  const recurringGrowthPct =
    firstBook != null && latestBook != null && firstBook !== 0 ? ((latestBook - firstBook) / firstBook) * 100 : null;
  const ebitdaPctYtd = get("ebitda_pct", "ytd").actual;
  const ruleOf40 = recurringGrowthPct != null && ebitdaPctYtd != null ? recurringGrowthPct + ebitdaPctYtd : null;
  const cashOps = get("cash_ops", basis).actual;
  const cashInv = get("cash_investing", basis).actual;
  const fcf = cashOps != null && cashInv != null ? cashOps + cashInv : null;
  const fcfConv = fcf != null && ebitdaSel != null && ebitdaSel !== 0 ? (fcf / ebitdaSel) * 100 : null;

  // ---- Book-movement waterfall (month) --------------------------------------
  const priorBook = prior ? cell(priorValues, "book_value", "company", "month").actual : null;
  const endingBook = get("book_value", "month").actual;
  const newSalesMonth = get("new_sales", "month").actual;
  const attritionMonth = get("attrition", "month").actual;
  let waterfallSteps: { label: string; value: number; kind: "total" | "increase" | "decrease" }[] | null = null;
  if (prior && priorBook != null && endingBook != null && newSalesMonth != null && attritionMonth != null) {
    const other = endingBook - priorBook - newSalesMonth + attritionMonth;
    waterfallSteps = [
      { label: `${prior.label} book`, value: priorBook, kind: "total" },
      { label: "New sales", value: newSalesMonth, kind: "increase" },
      { label: "Cancellations", value: attritionMonth, kind: "decrease" },
      { label: "Other / reclass", value: Math.abs(other), kind: other >= 0 ? "increase" : "decrease" },
      { label: `${period.label} book`, value: endingBook, kind: "total" },
    ];
  }

  // ---- Per-branch benchmarking (month) --------------------------------------
  const branchRows = BRANCHES.map((b) => ({
    key: b.key,
    label: b.label,
    prod: cell(values, "production", b.key, "month"),
    rc: cell(values, "route_contrib_pct", b.key, "month"),
    ns: cell(values, "new_sales", b.key, "month"),
    ar: cell(values, "attrition_rate", b.key, "month"),
  })).filter((r) => r.prod.actual != null || r.rc.actual != null || r.ns.actual != null);

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
        <PageHeader
          title="Board / Executive"
          subtitle={`Company financials · ${period.label}${basis === "ytd" ? " · YTD" : ""}`}
          actions={
            <Link
              href="/management/insights"
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-[#eef5f0] transition-colors"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8 8 0 01-11.8 7L3 20l1.5-5.5A8 8 0 1121 11.5z" />
              </svg>
              Ask Insights
            </Link>
          }
        />
        <Controls
          periods={periods.map((p) => ({ key: `${p.year}-${String(p.month).padStart(2, "0")}`, label: p.label }))}
          period={periodKey}
          basis={basis}
          basePath="/management/board"
        />
      </div>

      {/* Financial headline */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6 my-4">
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
        <AttritionRateTile c={get("attrition_rate")} isMonth={basis === "month"} />
      </div>

      {/* Capital & efficiency */}
      <div className="mt-6 mb-2 text-sm font-medium text-ink">Capital &amp; efficiency</div>

      {waterfallSteps ? (
        <Card className="p-4 mb-4">
          <PanelTitle>Book value bridge · {prior?.label} → {period.label}</PanelTitle>
          <div className="mt-2">
            <Waterfall steps={waterfallSteps} />
          </div>
          <p className="mt-2 text-[11px] text-muted">
            &ldquo;Other / reclass&rdquo; captures route reassignments and price changes not booked as new sales or cancellations.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        {/* Key ratios */}
        <Card className="p-0 overflow-hidden">
          <PanelHead>Key ratios · {period.label} (month-end)</PanelHead>
          <div className="divide-y divide-line">
            {ratios.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <div>
                  <div className="text-sm text-ink">{r.label}</div>
                  <div className="text-[11px] text-muted">{r.def}</div>
                </div>
                <div className="text-lg font-light tabular-nums text-ink shrink-0">{r.value}</div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-line text-[11px] text-muted">
            Point-in-time balance-sheet ratios; not budget-compared.
          </div>
        </Card>

        {/* Profitability */}
        <Card className="p-0 overflow-hidden">
          <PanelHead>Profitability · {basisLabel}</PanelHead>
          <div className="divide-y divide-line">
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm text-ink">Adjusted EBITDA</div>
                <div className="text-lg font-light tabular-nums text-ink shrink-0">{money(ebitdaSel)}</div>
              </div>
              <div className="text-[11px] text-muted">
                {pct(ebitdaPctSel)} margin · per MBR reconciliation, incl. add-backs
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm text-ink">Rule of 40</div>
                <div className="text-lg font-light tabular-nums text-ink shrink-0">
                  {ruleOf40 == null ? "—" : ruleOf40.toFixed(1)}
                </div>
              </div>
              <div className="text-[11px] text-muted">
                book-value growth YTD {pct(recurringGrowthPct)} + EBITDA margin {pct(ebitdaPctYtd)}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm text-ink">Free cash flow</div>
                <div className="text-lg font-light tabular-nums text-ink shrink-0">{money(fcf)}</div>
              </div>
              <div className="text-[11px] text-muted">
                {fcfConv == null ? "conversion —" : `${fcfConv.toFixed(0)}% conversion`} · operating cash − investing (capex)
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Branch benchmarking */}
      {branchRows.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-4">
          <PanelHead>Branch benchmarking · {period.label}</PanelHead>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium text-right">Production</th>
                  <th className="px-3 py-2 font-medium text-right">Δ vs budget</th>
                  <th className="px-3 py-2 font-medium text-right">Route contrib %</th>
                  <th className="px-3 py-2 font-medium text-right">New sales</th>
                  <th className="px-4 py-2 font-medium text-right">Attrition rate</th>
                </tr>
              </thead>
              <tbody>
                {branchRows.map((r) => {
                  const prodGood = r.prod.favorable === true;
                  const rcGood = r.rc.favorable === true;
                  return (
                    <tr key={r.key} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">{r.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(r.prod.actual)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.prod.variance == null ? "text-muted" : prodGood ? "text-emerald-700" : "text-red-600"}`}>
                        {r.prod.variance == null ? "—" : `${r.prod.variance >= 0 ? "+" : ""}${money(r.prod.variance)}`}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.rc.actual == null ? "text-muted" : r.rc.favorable == null ? "text-ink" : rcGood ? "text-emerald-700" : "text-red-600"}`}>
                        {r.rc.actual == null ? "—" : `${r.rc.actual.toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.ns.actual)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {r.ar.actual == null ? "—" : `${r.ar.actual.toFixed(2)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

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

        {/* SG&A line-item detail (collapsed by default) */}
        <Card className="p-0 overflow-hidden lg:col-span-2">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
              <span>SG&amp;A detail · {basisLabel}</span>
              <span className="flex items-center gap-2 text-[11px] font-normal text-muted">
                <span>Total SG&amp;A {money(get("sga").actual)}</span>
                <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </summary>
            <div className="border-t border-line">
              <KpiTable values={values} cat={cat} basis={basis} keys={SGA_DETAIL_KEYS} />
            </div>
            <div className="px-4 py-2 border-t border-line text-[11px] text-muted">
              Overhead compensation is shown only as aggregate buckets (Total Back-Office, Total Officer); no individual or manager compensation is stored. Line items may not tie exactly to Total SG&amp;A due to $0/rounding lines.
            </div>
          </details>
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
// Monthly attrition as a % of the forward recurring book. Best-in-class is losing
// under 1% of book per month (green); above that is flagged red. On a YTD basis
// it's the cumulative cancellations rate, so the monthly benchmark isn't applied.
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
