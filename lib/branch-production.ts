// Branch Command — technician production & route-integrity engine. PURE + unit-tested.
//
// Compares the monthly plan (the Technician Schedule Report, already loaded in Canopy
// as day-level RouteStop rows) against weekly PestPac actuals (production, underserviced,
// cancellations, new starts) to answer, per route/tech:
//   • completion — stops done vs scheduled (count) AND production $ vs scheduled $
//   • pace — are we where the SCHEDULE says we should be by today? (day-level, not a flat %)
//   • jobs left behind — past-due services not completed and not moved to a future day
//   • projection — likely month-end completion from the route's own throughput
//   • route size — net change from new starts minus cancellations (NOT "sales")
//
// Parsers (built against real PestPac samples) map each report into the normalized
// shapes below; this module never touches Prisma or a file format. See
// docs/BRANCH-COMMAND-REPORTS.md.

export type SchedStop = { account: string; route: string; techName: string; date: string; dollars: number }; // date = "YYYY-MM-DD"
export type CompletedRef = { account: string; date?: string; dollars?: number };
export type AccountRef = { account: string; route?: string; date?: string; dollars?: number };

export type ProductionInput = {
  today: string; // "YYYY-MM-DD" (ET)
  scheduled: SchedStop[]; // the month's plan (from the loaded schedule)
  completed: CompletedRef[]; // Technician Production Report (what's done)
  cancellations: AccountRef[]; // Cancellation Report (by route)
  newStarts: AccountRef[]; // New Start Report (accounts added/moved to a route)
  underservicedPastDue?: AccountRef[]; // Underserviced Report — past-due, not rescheduled
  rescheduledAccounts?: string[]; // accounts explicitly moved to a future day (so NOT left behind)
};

export type PaceStatus = "ahead" | "on_pace" | "behind" | "critical";
export type ProjectedStatus = "on_track" | "at_risk" | "wont_finish";

export type RouteProduction = {
  route: string;
  techName: string;
  scheduledCount: number;
  scheduledDollars: number;
  completedCount: number;
  completedDollars: number; // actual production $ (from the production report) for matched accounts
  completionPct: number; // completed ÷ scheduled, by count
  completionPctDollars: number; // production $ ÷ scheduled $
  expectedByTodayCount: number; // stops the schedule placed on/before today
  expectedPct: number; // expectedByToday ÷ scheduled
  paceDeltaPct: number; // completionPct − expectedPct (negative = behind)
  status: PaceStatus;
  remainingCount: number; // scheduled, future-dated, not yet done
  remainingDollars: number;
  remainingPct: number; // remaining ÷ scheduled
  leftBehind: { account: string; date: string }[];
  leftBehindCount: number;
  projectedCompletionPct: number; // projected month-end completion from current throughput
  projectedStatus: ProjectedStatus;
  cancellations: number;
  cancellationDollars: number;
  newStarts: number;
  newStartDollars: number;
  netRouteChange: number; // newStarts − cancellations (accounts)
  netRouteChangeDollars: number;
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function paceStatus(deltaPct: number): PaceStatus {
  if (deltaPct >= 3) return "ahead";
  if (deltaPct >= -5) return "on_pace";
  if (deltaPct >= -12) return "behind";
  return "critical";
}
function projectedStatus(projectedPct: number): ProjectedStatus {
  if (projectedPct >= 98) return "on_track";
  if (projectedPct >= 90) return "at_risk";
  return "wont_finish";
}

/** Per-route production + pacing. Routes come from the schedule (the plan is the spine). */
export function computeRouteProduction(input: ProductionInput): RouteProduction[] {
  const { today } = input;
  const completedSet = new Set(input.completed.map((c) => c.account));
  const completedDollarByAccount = new Map<string, number>();
  for (const c of input.completed) if (c.dollars != null) completedDollarByAccount.set(c.account, c.dollars);
  const rescheduled = new Set(input.rescheduledAccounts ?? []);

  // Group the schedule by route.
  const byRoute = new Map<string, SchedStop[]>();
  for (const s of input.scheduled) {
    if (!byRoute.has(s.route)) byRoute.set(s.route, []);
    byRoute.get(s.route)!.push(s);
  }
  const cancByRoute = groupRefs(input.cancellations);
  const startByRoute = groupRefs(input.newStarts);
  const underByRoute = groupRefs(input.underservicedPastDue ?? []);

  const out: RouteProduction[] = [];
  for (const [route, stops] of byRoute) {
    const techName = stops[0]?.techName ?? route;
    const scheduledCount = stops.length;
    const scheduledDollars = sum(stops.map((s) => s.dollars || 0));

    const done = stops.filter((s) => completedSet.has(s.account));
    const completedCount = done.length;
    const completedDollars = sum(done.map((s) => completedDollarByAccount.get(s.account) ?? s.dollars));

    const expectedByTodayCount = stops.filter((s) => s.date <= today).length;
    const remainingStops = stops.filter((s) => s.date > today && !completedSet.has(s.account));
    const remainingCount = remainingStops.length;
    const remainingDollars = sum(remainingStops.map((s) => s.dollars || 0));

    // Left behind: past-due, not done, not moved forward — union of computed + report.
    const computedLB = stops
      .filter((s) => s.date < today && !completedSet.has(s.account) && !rescheduled.has(s.account))
      .map((s) => ({ account: s.account, date: s.date }));
    const reportLB = (underByRoute.get(route) ?? []).map((r) => ({ account: r.account, date: r.date ?? "" }));
    const leftBehind = dedupeByAccount([...computedLB, ...reportLB]);

    // Projection from the route's own throughput over elapsed service days.
    const elapsedDays = new Set(stops.filter((s) => s.date <= today).map((s) => s.date)).size;
    const remainingDays = new Set(stops.filter((s) => s.date > today).map((s) => s.date)).size;
    const dailyRate = completedCount / Math.max(elapsedDays, 1);
    const projectedCount = Math.min(scheduledCount, completedCount + dailyRate * remainingDays);
    const projectedCompletionPct = pct(projectedCount, scheduledCount);

    const completionPct = pct(completedCount, scheduledCount);
    const expectedPct = pct(expectedByTodayCount, scheduledCount);
    const paceDeltaPct = Math.round((completionPct - expectedPct) * 10) / 10;

    const canc = cancByRoute.get(route) ?? [];
    const starts = startByRoute.get(route) ?? [];

    out.push({
      route, techName,
      scheduledCount, scheduledDollars,
      completedCount, completedDollars,
      completionPct, completionPctDollars: pct(completedDollars, scheduledDollars),
      expectedByTodayCount, expectedPct,
      paceDeltaPct, status: paceStatus(paceDeltaPct),
      remainingCount, remainingDollars, remainingPct: pct(remainingCount, scheduledCount),
      leftBehind, leftBehindCount: leftBehind.length,
      projectedCompletionPct, projectedStatus: projectedStatus(projectedCompletionPct),
      cancellations: canc.length, cancellationDollars: sum(canc.map((c) => c.dollars || 0)),
      newStarts: starts.length, newStartDollars: sum(starts.map((s) => s.dollars || 0)),
      netRouteChange: starts.length - canc.length,
      netRouteChangeDollars: Math.round((sum(starts.map((s) => s.dollars || 0)) - sum(canc.map((c) => c.dollars || 0))) * 100) / 100,
    });
  }
  return out.sort((a, b) => b.scheduledCount - a.scheduledCount);
}

export type BranchProduction = {
  routes: RouteProduction[];
  totals: {
    scheduledCount: number; completedCount: number; completionPct: number;
    expectedPct: number; paceDeltaPct: number; status: PaceStatus;
    leftBehindCount: number; remainingCount: number; projectedCompletionPct: number;
    cancellations: number; newStarts: number; netRouteChange: number;
    scheduledDollars: number; completedDollars: number;
  };
};

/** Branch rollup across routes. */
export function computeBranchProduction(input: ProductionInput): BranchProduction {
  const routes = computeRouteProduction(input);
  const scheduledCount = sum(routes.map((r) => r.scheduledCount));
  const completedCount = sum(routes.map((r) => r.completedCount));
  const expectedByToday = sum(routes.map((r) => r.expectedByTodayCount));
  const completionPct = pct(completedCount, scheduledCount);
  const expectedPct = pct(expectedByToday, scheduledCount);
  const paceDeltaPct = Math.round((completionPct - expectedPct) * 10) / 10;
  const projectedCount = sum(routes.map((r) => (r.projectedCompletionPct / 100) * r.scheduledCount));
  return {
    routes,
    totals: {
      scheduledCount, completedCount, completionPct, expectedPct, paceDeltaPct, status: paceStatus(paceDeltaPct),
      leftBehindCount: sum(routes.map((r) => r.leftBehindCount)),
      remainingCount: sum(routes.map((r) => r.remainingCount)),
      projectedCompletionPct: pct(projectedCount, scheduledCount),
      cancellations: sum(routes.map((r) => r.cancellations)),
      newStarts: sum(routes.map((r) => r.newStarts)),
      netRouteChange: sum(routes.map((r) => r.netRouteChange)),
      scheduledDollars: sum(routes.map((r) => r.scheduledDollars)),
      completedDollars: sum(routes.map((r) => r.completedDollars)),
    },
  };
}

function groupRefs(refs: AccountRef[]): Map<string, AccountRef[]> {
  const m = new Map<string, AccountRef[]>();
  for (const r of refs) {
    const k = r.route ?? "";
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}
function dedupeByAccount(rows: { account: string; date: string }[]): { account: string; date: string }[] {
  const seen = new Set<string>();
  const out: { account: string; date: string }[] = [];
  for (const r of rows) {
    if (seen.has(r.account)) continue;
    seen.add(r.account);
    out.push(r);
  }
  return out;
}
