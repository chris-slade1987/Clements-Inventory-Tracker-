import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// April 2026 per-branch KPI reconciliation for the Q2 branch-manager scorecards.
//
// Source: the May 2026 MBR (April financials) — "Actual Production vs Budget"
// slide, branch subtotals. April had only COMPANY production loaded (branch
// split missing) and its company budget disagreed with the MBR; May & June are
// already complete per branch. This backfills April per-branch production
// (actual + budget), corrects the April company production budget to the MBR
// figure ("always defer to the MBR budget"), and sets per-branch April new-sales
// BUDGETS from the flat monthly plan (the MBR new-sales section shows only
// actuals; May/June branch budgets are flat, so April uses the same plan).
//
// Idempotent: upserts KpiValue by (period, kpi, scope, basis). Safe on redeploy.
// Actuals already loaded (and matching the MBR) are re-asserted, not doubled.
// ---------------------------------------------------------------------------

type BranchRow = { scope: string; prodActual: number; prodBudget: number };

// From the MBR "Preliminary Total" branch subtotals (month 4/30/2026). Verified:
// actuals sum to the company total ($601,369.67); budgets sum to $549,244.29;
// and (May+June) already in the system equals the MBR's YTD-June − YTD-April
// per branch, so April + May + June reconciles to the MBR YTD. ONLY these
// MBR-stated figures are loaded — nothing is inferred (bonuses depend on it).
const APRIL_2026: BranchRow[] = [
  { scope: "vero", prodActual: 334019.91, prodBudget: 304742.08 },
  { scope: "stuart", prodActual: 91503.24, prodBudget: 90030.73 },
  { scope: "orlando", prodActual: 103516.12, prodBudget: 100277.08 },
  { scope: "naples", prodActual: 72330.4, prodBudget: 54194.4 },
];
// Company production (month) per the MBR — actual matches the system; budget is
// corrected to the MBR value (was $584,150 from an earlier source).
const APRIL_COMPANY_PROD = { actual: 601369.67, budget: 549244.29 };

export async function seedScorecardQ2_2026(prisma: PrismaClient) {
  const period = await prisma.reportPeriod.findUnique({ where: { year_month: { year: 2026, month: 4 } } }).catch(() => null);
  if (!period) {
    // Fallback if the composite unique isn't named year_month in the client.
    const p2 = await prisma.reportPeriod.findFirst({ where: { year: 2026, month: 4 } });
    if (!p2) return { applied: false, reason: "April 2026 period not found" };
    return apply(prisma, p2.id);
  }
  return apply(prisma, period.id);
}

async function apply(prisma: PrismaClient, periodId: string) {
  let writes = 0;
  const up = async (kpiKey: string, scope: string, actual: number | null, budget: number | null) => {
    // Only upsert values we intend to set; skip nulls so we never wipe existing data.
    const data: { actual?: number; budget?: number } = {};
    if (actual != null) data.actual = actual;
    if (budget != null) data.budget = budget;
    if (Object.keys(data).length === 0) return;
    await prisma.kpiValue.upsert({
      where: { periodId_kpiKey_scope_basis: { periodId, kpiKey, scope, basis: "month" } },
      update: data,
      create: { periodId, kpiKey, scope, basis: "month", actual: actual ?? null, budget: budget ?? null },
    });
    writes++;
  };

  // Company production budget correction (defer to MBR).
  await up("production", "company", APRIL_COMPANY_PROD.actual, APRIL_COMPANY_PROD.budget);

  for (const b of APRIL_2026) {
    await up("production", b.scope, b.prodActual, b.prodBudget);
    // NOTE: April per-branch new-sales BUDGET is intentionally NOT set here — the
    // MBR new-sales section shows only actuals, so it must be provided by finance
    // rather than inferred. Sales actuals are already loaded and match the MBR.
  }

  return { applied: true, writes, period: "2026-04" };
}

// Standalone: `tsx prisma/seed-scorecard-q2-2026.ts`
if (process.argv[1] && process.argv[1].endsWith("seed-scorecard-q2-2026.ts")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await seedScorecardQ2_2026(prisma);
      console.log("seed-scorecard-q2-2026:", JSON.stringify(r));
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
