import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

// Re-assert the per-branch **New Sales** (actual + budget) and **Attrition**
// (actual) rows from the June 2026 MBR on every deploy.
//
// Why this exists: `seedMbrJune` only writes when the 2026-06 ReportPeriod is
// first created (so a later in-app upload is never clobbered). A production
// database that was seeded BEFORE these branch rows were added to the MBR file
// would therefore be missing the branch-level New Sales budgets and the
// per-branch cancellation actuals — which are exactly what the branch manager
// scorecards read (branch-specific New Sales target; book-based cancellation /
// attrition-rate scoring). This idempotent upsert guarantees they're present and
// current on every deploy without touching any other MBR data.
//
// Source of truth is the MBR JSON itself (not a hardcoded copy), so the two can
// never drift. Non-fatal by contract — the caller wraps it in try/catch.

const SCORECARD_BRANCHES = ["vero", "stuart", "orlando", "naples"];
const KEYS = ["new_sales", "attrition"];

type MbrKpi = { key: string; scope?: string; basis?: string; actual?: number | null; budget?: number | null };

export async function seedBranchSalesAttrition(prisma: PrismaClient) {
  const doc = JSON.parse(
    readFileSync(join(process.cwd(), "prisma", "data", "mbr-2026-06.json"), "utf8"),
  ) as { year: number; month: number; kpis: MbrKpi[] };

  const period = await prisma.reportPeriod.findFirst({ where: { year: doc.year, month: doc.month } });
  if (!period) return { written: 0, note: "no 2026-06 period yet" as const };

  let written = 0;
  for (const r of doc.kpis) {
    if (!KEYS.includes(r.key) || !r.scope || !SCORECARD_BRANCHES.includes(r.scope)) continue;
    const basis = r.basis ?? "month";
    const data: { actual?: number | null; budget?: number | null } = {};
    if (r.actual != null) data.actual = r.actual;
    if (r.budget != null) data.budget = r.budget;
    await prisma.kpiValue.upsert({
      where: { periodId_kpiKey_scope_basis: { periodId: period.id, kpiKey: r.key, scope: r.scope, basis } },
      update: data,
      create: { periodId: period.id, kpiKey: r.key, scope: r.scope, basis, actual: r.actual ?? null, budget: r.budget ?? null },
    });
    written++;
  }
  return { written };
}
