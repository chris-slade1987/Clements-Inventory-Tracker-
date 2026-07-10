// PLACEHOLDER monthly purchasing budgets per branch, keyed by warehouse name.
// Chris will provide real figures; these are stand-ins so the dashboard's
// budget-vs-actual layout is visible. Wire to editable settings later.
export const MONTHLY_BUDGET: Record<string, number> = {
  "Vero Beach (HQ)": 60000,
  Stuart: 25000,
  Orlando: 18000,
  Naples: 22000,
};

export const DEFAULT_MONTHLY_BUDGET = 20000;

export function monthlyBudgetFor(name: string): number {
  return MONTHLY_BUDGET[name] ?? DEFAULT_MONTHLY_BUDGET;
}

/** Current month + year-to-date date ranges (server-render time). */
export function currentPeriods(now: Date) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return {
    now,
    monthStart,
    yearStart,
    monthLabel: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    monthIndex: now.getMonth() + 1, // 1-based, for YTD budget = monthly * months elapsed
  };
}
