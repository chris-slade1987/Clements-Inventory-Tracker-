import { bonusTierFor, BONUS_PARTICIPATING_BRANCHES } from "@/lib/sales-review";
import { branchLabel } from "@/lib/management";

// Verified monthly Total Branch Sales from the PestPac close-won export
// (Aug–Oct 2026; 452 deals; "Total Value" column, by deal-created month). The
// in-app sales feed isn't connected yet, so these back Howard's quarterly review.
// Source workbook: Sales_CloseWon_Summary_Aug-Oct_2026.xlsx (Sales Team folder).
export const BRANCH_SALES_2026: Record<string, Record<string, number>> = {
  naples: { "2026-08": 26118, "2026-09": 23180, "2026-10": 49685 },
  orlando: { "2026-08": 23069, "2026-09": 31689, "2026-10": 41913 },
  stuart: { "2026-08": 22493, "2026-09": 28675, "2026-10": 16951 },
  vero: { "2026-08": 69110, "2026-09": 93518, "2026-10": 38184 },
};

export const MIN_BONUS_TIER = 50000;

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(key: string): string {
  const m = Number(key.slice(5, 7));
  return `${MONTH_ABBR[m] ?? key} ${key.slice(0, 4)}`;
}
export function monthShort(key: string): string {
  return MONTH_ABBR[Number(key.slice(5, 7))] ?? key;
}

/** The months a quarter's bonus is scored on. Q3 2026 for Howard = Aug + Sep only
 *  (he started Aug 3, 2026; no July production), per the COO. Other quarters use
 *  the full three months we have data for. Future/no-data months are dropped. */
export function bonusMonths(year: number, quarter: number): string[] {
  let months: string[];
  if (year === 2026 && quarter === 3) months = ["2026-08", "2026-09"];
  else {
    const start = (quarter - 1) * 3 + 1;
    months = [0, 1, 2].map((i) => `${year}-${String(start + i).padStart(2, "0")}`);
  }
  // Only months we actually have data for (any branch).
  return months.filter((m) => Object.values(BRANCH_SALES_2026).some((b) => b[m] != null));
}

export type MonthCell = { key: string; label: string; sales: number; pct: number; bonus: number; pctOfMin: number; hit: boolean };
export type BranchBonusRow = { branch: string; label: string; months: MonthCell[]; totalSales: number; totalBonus: number };

export type BonusBreakdown = {
  months: string[];
  branches: BranchBonusRow[]; // participating only (Stuart, Naples, Orlando)
  vero: { months: { key: string; label: string; sales: number }[]; totalSales: number } | null;
  grandBonus: number;
  branchMonths: number;
  hitCount: number;
  closest: { label: string; monthKey: string; sales: number; pctOfMin: number } | null;
  hasData: boolean;
};

function cell(key: string, sales: number): MonthCell {
  const { pct } = bonusTierFor(sales);
  const bonus = pct > 0 ? Math.round((sales * pct) / 100) : 0;
  return { key, label: monthShort(key), sales, pct, bonus, pctOfMin: Math.round((sales / MIN_BONUS_TIER) * 100), hit: sales >= MIN_BONUS_TIER };
}

/** The objective quarterly bonus breakdown from the verified export — per focus
 *  branch per month vs. the agreement's tiers, the total bonus, and the closest
 *  near-miss. This is what the review is squarely scored on. */
export function quarterlyBonusBreakdown(year: number, quarter: number): BonusBreakdown {
  const months = bonusMonths(year, quarter);
  const participating = BONUS_PARTICIPATING_BRANCHES as readonly string[];
  const branches: BranchBonusRow[] = participating.map((b) => {
    const cells = months.map((m) => cell(m, BRANCH_SALES_2026[b]?.[m] ?? 0));
    return {
      branch: b,
      label: branchLabel(b),
      months: cells,
      totalSales: cells.reduce((s, c) => s + c.sales, 0),
      totalBonus: cells.reduce((s, c) => s + c.bonus, 0),
    };
  });

  const veroCells = months.map((m) => ({ key: m, label: monthShort(m), sales: BRANCH_SALES_2026.vero?.[m] ?? 0 }));
  const vero = veroCells.some((c) => c.sales > 0)
    ? { months: veroCells, totalSales: veroCells.reduce((s, c) => s + c.sales, 0) }
    : null;

  const allCells = branches.flatMap((b) => b.months.map((c) => ({ branchLabel: b.label, ...c })));
  const grandBonus = branches.reduce((s, b) => s + b.totalBonus, 0);
  const misses = allCells.filter((c) => !c.hit).sort((a, b) => b.sales - a.sales);
  const closest = misses.length ? { label: misses[0].branchLabel, monthKey: misses[0].key, sales: misses[0].sales, pctOfMin: misses[0].pctOfMin } : null;

  return {
    months,
    branches,
    vero,
    grandBonus,
    branchMonths: allCells.length,
    hitCount: allCells.filter((c) => c.hit).length,
    closest,
    hasData: months.length > 0,
  };
}

/** The month just after the quarter (an un-scored "early next-quarter" look), if we
 *  have data for it. For Q3 2026 that's October. */
export function nextMonthPeek(year: number, quarter: number): { key: string; label: string; branches: { label: string; sales: number; hit: boolean; pctOfMin: number }[] } | null {
  const months = bonusMonths(year, quarter);
  if (months.length === 0) return null;
  const last = months[months.length - 1];
  const m = Number(last.slice(5, 7)) + 1;
  const peekKey = m > 12 ? null : `${last.slice(0, 4)}-${String(m).padStart(2, "0")}`;
  if (!peekKey || !Object.values(BRANCH_SALES_2026).some((b) => b[peekKey] != null)) return null;
  const participating = BONUS_PARTICIPATING_BRANCHES as readonly string[];
  return {
    key: peekKey,
    label: monthLabel(peekKey),
    branches: participating.map((b) => {
      const sales = BRANCH_SALES_2026[b]?.[peekKey] ?? 0;
      return { label: branchLabel(b), sales, hit: sales >= MIN_BONUS_TIER, pctOfMin: Math.round((sales / MIN_BONUS_TIER) * 100) };
    }),
  };
}
