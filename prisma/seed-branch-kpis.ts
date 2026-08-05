import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

// Load the CEO's 2026 Branch KPIs workbook (monthly Target + Actual per branch
// for production, new_sales, cancellations) into BranchKpiTarget. Idempotent
// upsert by (branch, year, month, kpiKey) — re-asserts on every deploy and never
// creates future ReportPeriods. Source JSON is prisma/data/branch-kpis-2026.json,
// extracted from 79a53721-2026_Branch_KPIs.xlsx (reconciles to the budget model:
// company production FY ≈ $6.74M vs model $6.79M; branch new-sales quarterly sums
// tie to the MBR YTD new-sales budgets).

type MonthCell = { m: number; target: number | null; actual: number | null };
type Doc = Record<string, Record<string, MonthCell[]>>;

const YEAR = 2026;
const KEYS = ["production", "new_sales", "cancellations"];

export async function seedBranchKpis(prisma: PrismaClient) {
  const doc = JSON.parse(
    readFileSync(join(process.cwd(), "prisma", "data", "branch-kpis-2026.json"), "utf8"),
  ) as Doc;

  let written = 0;
  for (const branch of Object.keys(doc)) {
    for (const kpiKey of KEYS) {
      const months = doc[branch]?.[kpiKey] ?? [];
      for (const cell of months) {
        if (cell.target == null && cell.actual == null) continue;
        await prisma.branchKpiTarget.upsert({
          where: { branch_year_month_kpiKey: { branch, year: YEAR, month: cell.m, kpiKey } },
          update: { target: cell.target ?? null, actual: cell.actual ?? null },
          create: { branch, year: YEAR, month: cell.m, kpiKey, target: cell.target ?? null, actual: cell.actual ?? null },
        });
        written++;
      }
    }
  }
  return { written };
}
