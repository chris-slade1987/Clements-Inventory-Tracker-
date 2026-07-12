// Seeds the management-reporting tables from the CFO board financials (MBR) and
// the CEO prep briefs for Feb–May 2026. Aggregate KPIs only — NO manager
// compensation is stored. Per-technician production arrives via monthly import.
//
// Run: npx tsx prisma/seed-management.ts
import { PrismaClient } from "@prisma/client";

// KPI catalog. higherIsBetter drives favorable/unfavorable variance coloring.
const KPIS: { key: string; label: string; group: string; unit: string; higherIsBetter: boolean }[] = [
  { key: "net_revenue", label: "Net Revenue", group: "Headline", unit: "usd", higherIsBetter: true },
  { key: "operating_income", label: "Operating Income", group: "Headline", unit: "usd", higherIsBetter: true },
  { key: "ebitda", label: "EBITDA", group: "PnL", unit: "usd", higherIsBetter: true },
  { key: "ebitda_pct", label: "EBITDA %", group: "Headline", unit: "pct", higherIsBetter: true },
  { key: "route_contrib", label: "Route Contribution", group: "RouteContribution", unit: "usd", higherIsBetter: true },
  { key: "route_contrib_pct", label: "Route Contribution %", group: "Headline", unit: "pct", higherIsBetter: true },
  { key: "ending_cash", label: "Ending Cash", group: "Headline", unit: "usd", higherIsBetter: true },
  { key: "production", label: "Production", group: "Production", unit: "usd", higherIsBetter: true },
  { key: "book_value", label: "Forward 12-Mo Book Value", group: "Production", unit: "usd", higherIsBetter: true },
  { key: "new_sales", label: "New Sales", group: "Sales", unit: "usd", higherIsBetter: true },
  { key: "attrition", label: "Attrition", group: "Attrition", unit: "usd", higherIsBetter: false },
  { key: "attrition_rate", label: "Attrition Rate", group: "Attrition", unit: "pct", higherIsBetter: false },
  { key: "tech_wages", label: "Technician Wages", group: "RouteContribution", unit: "usd", higherIsBetter: false },
  { key: "fuel", label: "Fuel", group: "RouteContribution", unit: "usd", higherIsBetter: false },
  { key: "chemical_expense", label: "Chemical Expense", group: "RouteContribution", unit: "usd", higherIsBetter: false },
  { key: "vehicle_rm", label: "Vehicle R&M", group: "RouteContribution", unit: "usd", higherIsBetter: false },
  { key: "sga", label: "Total SG&A", group: "PnL", unit: "usd", higherIsBetter: false },
  { key: "net_income", label: "Net Income", group: "PnL", unit: "usd", higherIsBetter: true },
];

type V = { kpi: string; scope?: string; basis?: string; actual?: number | null; budget?: number | null };

const PERIODS: {
  year: number; month: number; label: string; values: V[];
  lob?: Record<string, Record<string, number>>;
  leadSources?: { source: string; revenueMonth: number; revenueYtd?: number }[];
}[] = [
  {
    year: 2026, month: 1, label: "Jan 2026",
    values: [
      { kpi: "book_value", actual: 6156540 },
      { kpi: "new_sales", actual: 105938 },
      { kpi: "new_sales", scope: "vero", actual: 50135 },
      { kpi: "new_sales", scope: "stuart", actual: 21137 },
      { kpi: "new_sales", scope: "orlando", actual: 14216 },
      { kpi: "new_sales", scope: "naples", actual: 20450 },
    ],
  },
  {
    year: 2026, month: 2, label: "Feb 2026",
    values: [
      { kpi: "net_revenue", actual: 553445, budget: 494357 },
      { kpi: "route_contrib", actual: 258710, budget: 190513 },
      { kpi: "route_contrib_pct", actual: 46.75, budget: 38.54 },
      { kpi: "ending_cash", actual: 348000 },
      { kpi: "book_value", actual: 6136601 },
      { kpi: "production", actual: 553445, budget: 494357 },
      { kpi: "new_sales", actual: 96438 },
      { kpi: "new_sales", scope: "vero", actual: 40399 },
      { kpi: "new_sales", scope: "stuart", actual: 16499 },
      { kpi: "new_sales", scope: "orlando", actual: 23384 },
      { kpi: "new_sales", scope: "naples", actual: 16156 },
    ],
  },
  {
    year: 2026, month: 3, label: "Mar 2026",
    values: [
      { kpi: "net_revenue", actual: 587000, budget: 636000 },
      { kpi: "operating_income", actual: 25500, budget: 130000 },
      { kpi: "ebitda_pct", actual: 6.7, budget: 21.0 },
      { kpi: "route_contrib_pct", actual: 32.8, budget: 44.9 },
      { kpi: "book_value", actual: 6183944 },
      { kpi: "production", actual: 587000, budget: 636000 },
      { kpi: "new_sales", actual: 120573, budget: 92000 },
      { kpi: "new_sales", scope: "vero", actual: 55626 },
      { kpi: "new_sales", scope: "stuart", actual: 16922 },
      { kpi: "new_sales", scope: "orlando", actual: 17156 },
      { kpi: "new_sales", scope: "naples", actual: 30869 },
    ],
  },
  {
    year: 2026, month: 4, label: "Apr 2026",
    values: [
      { kpi: "net_revenue", actual: 601370, budget: 584150 },
      { kpi: "operating_income", actual: 74096, budget: 88962 },
      { kpi: "ebitda_pct", actual: 13.1, budget: 16.5 },
      { kpi: "route_contrib_pct", actual: 41.1, budget: 42.5 },
      { kpi: "ending_cash", actual: 308929 },
      { kpi: "book_value", actual: 6229169 },
      { kpi: "production", actual: 601370, budget: 584150 },
      { kpi: "new_sales", actual: 153062, budget: 102000 },
      { kpi: "new_sales", scope: "vero", actual: 78824 },
      { kpi: "new_sales", scope: "stuart", actual: 18420 },
      { kpi: "new_sales", scope: "orlando", actual: 19559 },
      { kpi: "new_sales", scope: "naples", actual: 36259 },
      { kpi: "attrition", scope: "vero", actual: 30216 },
      { kpi: "attrition", scope: "stuart", actual: 15022 },
      { kpi: "attrition", scope: "orlando", actual: 5519 },
      { kpi: "attrition", scope: "naples", actual: 11384 },
      { kpi: "attrition", actual: 62141 },
    ],
  },
  {
    year: 2026, month: 5, label: "May 2026",
    values: [
      // Company — month
      { kpi: "net_revenue", actual: 562499, budget: 567513 },
      { kpi: "operating_income", actual: 45487, budget: 80485 },
      { kpi: "ebitda", actual: 54339, budget: 88214 },
      { kpi: "ebitda_pct", actual: 9.7, budget: 15.5 },
      { kpi: "route_contrib", actual: 216393, budget: 240077 },
      { kpi: "route_contrib_pct", actual: 38.4, budget: 42.2 },
      { kpi: "ending_cash", actual: 289961 },
      { kpi: "production", actual: 562947, budget: 526267 },
      { kpi: "book_value", actual: 6494107 },
      { kpi: "new_sales", actual: 114405, budget: 112000 },
      { kpi: "attrition", actual: 51433, budget: 47850 },
      { kpi: "attrition_rate", actual: 0.83 },
      { kpi: "tech_wages", actual: 133626, budget: 158007 },
      { kpi: "fuel", actual: 19388, budget: 11369 },
      { kpi: "chemical_expense", actual: 75806, budget: 67491 },
      { kpi: "vehicle_rm", actual: 17616, budget: 11433 },
      { kpi: "sga", actual: 170907, budget: 159592 },
      { kpi: "net_income", actual: -6517, budget: -15393 },
      // Company — YTD
      { kpi: "net_revenue", basis: "ytd", actual: 2798689, budget: 2734152 },
      { kpi: "route_contrib", basis: "ytd", actual: 1166762, budget: 1119087 },
      { kpi: "route_contrib_pct", basis: "ytd", actual: 41.6, budget: 40.9 },
      { kpi: "fuel", basis: "ytd", actual: 76660, budget: 56263 },
      { kpi: "chemical_expense", basis: "ytd", actual: 354749, budget: 305968 },
      { kpi: "vehicle_rm", basis: "ytd", actual: 64328, budget: 58310 },
      { kpi: "sga", basis: "ytd", actual: 832431, budget: 777969 },
      { kpi: "operating_income", basis: "ytd", actual: 334331, budget: 341119 },
      { kpi: "ebitda", basis: "ytd", actual: 361493, budget: 363208 },
      { kpi: "ebitda_pct", basis: "ytd", actual: 12.9, budget: 13.3 },
      { kpi: "net_income", basis: "ytd", actual: 78324, budget: -17033 },
      { kpi: "new_sales", basis: "ytd", actual: 590416, budget: 475000 },
      { kpi: "attrition", basis: "ytd", actual: 284547 },
      // Branch — production scorecard (month). Source: MBR "Preliminary Total"
      // branch rollup (the authoritative CFO figures), not the CEO-brief scorecard.
      { kpi: "production", scope: "vero", actual: 328821, budget: 299772 },
      { kpi: "production", scope: "stuart", actual: 83020, budget: 81331 },
      { kpi: "production", scope: "orlando", actual: 103232, budget: 103145 },
      { kpi: "production", scope: "naples", actual: 47874, budget: 42019 },
      // Branch + company — production YTD (MBR Preliminary Total, YTD 05/31/26)
      { kpi: "production", basis: "ytd", actual: 2806913, budget: 2587602 },
      { kpi: "production", scope: "vero", basis: "ytd", actual: 1511301, budget: 1393528 },
      { kpi: "production", scope: "stuart", basis: "ytd", actual: 442070, budget: 426508 },
      { kpi: "production", scope: "orlando", basis: "ytd", actual: 517129, budget: 522166 },
      { kpi: "production", scope: "naples", basis: "ytd", actual: 336412, budget: 245400 },
      // Branch — route contribution (month): actual $ and margin % (actual/budget)
      { kpi: "route_contrib", scope: "vero", actual: 154810 },
      { kpi: "route_contrib", scope: "stuart", actual: 29168 },
      { kpi: "route_contrib", scope: "orlando", actual: 18126 },
      { kpi: "route_contrib", scope: "naples", actual: 14289 },
      { kpi: "route_contrib_pct", scope: "vero", actual: 40.2, budget: 44.2 },
      { kpi: "route_contrib_pct", scope: "stuart", actual: 35.5, budget: 38.0 },
      { kpi: "route_contrib_pct", scope: "orlando", actual: 32.5, budget: 35.8 },
      { kpi: "route_contrib_pct", scope: "naples", actual: 43.5, budget: 55.9 },
      // Branch — new sales (month) + targets
      { kpi: "new_sales", scope: "vero", actual: 64975, budget: 40000 },
      { kpi: "new_sales", scope: "stuart", actual: 19123, budget: 33000 },
      { kpi: "new_sales", scope: "orlando", actual: 17569, budget: 24000 },
      { kpi: "new_sales", scope: "naples", actual: 12738, budget: 15000 },
      // Branch — attrition (month)
      { kpi: "attrition", scope: "vero", actual: 27103 },
      { kpi: "attrition", scope: "stuart", actual: 11799 },
      { kpi: "attrition", scope: "orlando", actual: 10387 },
      { kpi: "attrition", scope: "naples", actual: 2144 },
      { kpi: "attrition_rate", scope: "vero", actual: 0.81 },
      { kpi: "attrition_rate", scope: "stuart", actual: 1.12 },
      { kpi: "attrition_rate", scope: "orlando", actual: 0.89 },
      { kpi: "attrition_rate", scope: "naples", actual: 0.37 },
    ],
    leadSources: [
      { source: "Online / Digital", revenueMonth: 30397, revenueYtd: 146020 },
      { source: "Existing Customer", revenueMonth: 15751, revenueYtd: 140410 },
      { source: "Customer Referrals", revenueMonth: 13573, revenueYtd: 64953 },
      { source: "Prior Customers", revenueMonth: 11962, revenueYtd: 35127 },
      { source: "Vendor Referrals", revenueMonth: 9649, revenueYtd: 64443 },
      { source: "Clements Ops", revenueMonth: 2623, revenueYtd: 32510 },
      { source: "Unallocated", revenueMonth: 17829, revenueYtd: 61331 },
    ],
    lob: {
      company: { Pest: 210045, Fertilizer: 92827, "L&O": 142814, Termite: 63638, Rat: 33247, Ant: 7665, Mosquito: 3516, Other: 9196 },
      vero: { Pest: 107533, Fertilizer: 81718, "L&O": 95490, Termite: 16901, Rat: 11861, Ant: 5830, Mosquito: 2444, Other: 5078 },
      stuart: { Pest: 42820, Fertilizer: 9252, "L&O": 18041, Termite: 7060, Rat: 5133, Ant: 955, Mosquito: 879, Other: 847 },
      orlando: { Pest: 44433, Fertilizer: 0, "L&O": 19746, Termite: 34182, Rat: 2700, Ant: 880, Mosquito: 108, Other: 1183 },
      naples: { Pest: 15259, Fertilizer: 1857, "L&O": 9537, Termite: 5495, Rat: 13553, Ant: 0, Mosquito: 85, Other: 2088 },
    },
  },
];

export async function seedManagement(prisma: PrismaClient) {
  // KPI catalog.
  for (const [i, k] of KPIS.entries()) {
    await prisma.kpi.upsert({
      where: { key: k.key },
      create: { ...k, sortOrder: i },
      update: { label: k.label, group: k.group, unit: k.unit, higherIsBetter: k.higherIsBetter, sortOrder: i },
    });
  }

  for (const p of PERIODS) {
    const period = await prisma.reportPeriod.upsert({
      where: { year_month: { year: p.year, month: p.month } },
      create: { year: p.year, month: p.month, label: p.label },
      update: { label: p.label },
    });
    // Reset this period's values so re-seeding is idempotent.
    await prisma.kpiValue.deleteMany({ where: { periodId: period.id } });
    await prisma.lobRevenue.deleteMany({ where: { periodId: period.id } });
    await prisma.leadSource.deleteMany({ where: { periodId: period.id } });

    for (const v of p.values) {
      await prisma.kpiValue.create({
        data: {
          periodId: period.id,
          kpiKey: v.kpi,
          scope: v.scope ?? "company",
          basis: v.basis ?? "month",
          actual: v.actual ?? null,
          budget: v.budget ?? null,
        },
      });
    }
    if (p.lob) {
      for (const [scope, byLob] of Object.entries(p.lob)) {
        for (const [lob, revenue] of Object.entries(byLob)) {
          await prisma.lobRevenue.create({ data: { periodId: period.id, scope, lob, revenue } });
        }
      }
    }
    if (p.leadSources) {
      for (const ls of p.leadSources) {
        await prisma.leadSource.create({
          data: { periodId: period.id, scope: "company", source: ls.source, revenueMonth: ls.revenueMonth, revenueYtd: ls.revenueYtd ?? null },
        });
      }
    }
  }

  const periods = await prisma.reportPeriod.count();
  const values = await prisma.kpiValue.count();
  console.log(`Seeded ${periods} periods, ${values} KPI values, ${KPIS.length} KPI definitions.`);
  return { periods, values };
}

// CLI: `npx tsx prisma/seed-management.ts`
if (process.argv[1] && process.argv[1].includes("seed-management")) {
  const prisma = new PrismaClient();
  seedManagement(prisma)
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
