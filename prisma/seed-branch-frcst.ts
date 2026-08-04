import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Branch-level KPIs for the manager dashboard + scorecards, loaded from the
// CANONICAL budget model (Clements_Model_UPDATED_FORECAST__7926.xlsx, 7/9/2026,
// sheet "Branch Frcst"). This is the model the MMR and MBR both pull from.
//
// Writes branch-scoped KpiValue rows (scope = vero|stuart|orlando|naples) for the
// 2026-06 ReportPeriod at three bases:
//   month        → June actual / budget
//   ytd          → Jan–Jun actual / budget
//   cy_forecast  → full-year forecast (actual) vs full-year budget (YTD budget + ROY budget)
//
// Verified at extraction: the four branches' Production sums to the company MBR
// ($568,780 month / $3,375,694 YTD). Idempotent: upserts by the KpiValue unique
// key, so a re-run (or a later in-app edit) is never doubled. Nothing is
// inferred — only model-stated figures are loaded.
// ---------------------------------------------------------------------------

type Trip = { m: [number, number]; ytd: [number, number]; fy_fc: number; roy_bud?: number };
type Branch = Record<string, Trip>;
type Doc = {
  period: { year: number; month: number };
  kpis: Record<string, { label: string; unit: string; higherIsBetter: boolean }>;
  branches: Record<string, Branch>;
};

export async function seedBranchFrcst(prisma: PrismaClient) {
  const doc: Doc = JSON.parse(readFileSync(join(process.cwd(), "prisma", "data", "branch-frcst-2026-06.json"), "utf8"));

  // 1) Ensure the KPI definitions exist (idempotent).
  let order = 60;
  for (const [key, def] of Object.entries(doc.kpis)) {
    await prisma.kpi.upsert({
      where: { key },
      update: { label: def.label, unit: def.unit, higherIsBetter: def.higherIsBetter },
      create: { key, label: def.label, group: "BranchScorecard", unit: def.unit, higherIsBetter: def.higherIsBetter, sortOrder: order++ },
    });
  }

  // 2) Resolve the 2026-06 period.
  const period =
    (await prisma.reportPeriod.findFirst({ where: { year: doc.period.year, month: doc.period.month } })) ??
    (await prisma.reportPeriod.create({ data: { year: doc.period.year, month: doc.period.month, label: "June 2026" } }));

  // 3) Write branch KpiValue rows.
  let written = 0;
  for (const [scope, kpis] of Object.entries(doc.branches)) {
    for (const [kpiKey, t] of Object.entries(kpis)) {
      const fyBudget = t.roy_bud != null ? Math.round((t.ytd[1] + t.roy_bud) * 100) / 100 : null;
      const rows: { basis: string; actual: number | null; budget: number | null }[] = [
        { basis: "month", actual: t.m[0], budget: t.m[1] },
        { basis: "ytd", actual: t.ytd[0], budget: t.ytd[1] },
        { basis: "cy_forecast", actual: t.fy_fc, budget: fyBudget },
      ];
      for (const r of rows) {
        await prisma.kpiValue.upsert({
          where: { periodId_kpiKey_scope_basis: { periodId: period.id, kpiKey, scope, basis: r.basis } },
          update: { actual: r.actual, budget: r.budget },
          create: { periodId: period.id, kpiKey, scope, basis: r.basis, actual: r.actual, budget: r.budget },
        });
        written++;
      }
    }
  }

  // 4) Roll-up verification — branch Production must tie to the company MBR.
  const prodYtd = await prisma.kpiValue.findMany({
    where: { periodId: period.id, kpiKey: "production", basis: "ytd", scope: { in: ["vero", "stuart", "orlando", "naples"] } },
    select: { actual: true },
  });
  const sumYtd = prodYtd.reduce((s, v) => s + (v.actual ?? 0), 0);
  const ok = Math.abs(sumYtd - 3375694) < 5;

  return { written, branchProductionYtdSum: Math.round(sumYtd), reconciles: ok };
}
