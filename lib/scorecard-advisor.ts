import { advisorGoal, periodLabel } from "@/lib/sales";
import { advisorStanding, salesPace } from "@/lib/sales-funnel";
import { listFocusItems } from "@/lib/sales-focus";

// Advisor Scorecard (CanopyOS vision Theme 6 — Accountability; the sales-motivation
// surface). A role-appropriate scorecard for a SERVICE ADVISOR, computed entirely
// from the ONE existing sales ledger — no new metrics, no second source:
//   • Sales attainment   — closed $ vs the month's $ goal (SalesPeriodStat / SalesGoalSheet)
//   • Close rate         — proposals → closed count vs target (lib/sales-funnel)
//   • Funnel conversion  — leads → proposals vs target (lib/sales-funnel)
//   • Goal set on time   — a committed goal in place by the 5th (SalesGoalSheet.createdAt)
//   • Focus follow-through— Focus Plan actions with a logged outcome (lib/sales-focus)
// Presented with the motivation kit (Gauge / KpiMeter / AchievementBar / rankMedal)
// on /me/sales (the advisor) and /sales/[id] (the Sales Director / super admins).

export type AdvisorMetricKind = "usd" | "pct" | "bool" | "count";

export type AdvisorScoreMetric = {
  key: string;
  label: string;
  weight: number; // relative weight in the composite
  kind: AdvisorMetricKind;
  value: number | null; // raw actual (for display)
  target: number | null; // raw target (for display)
  /** 0..1+ attainment vs target; null = no data yet (don't score / don't show red). */
  attainment: number | null;
  detail: string;
};

export type AdvisorScorecardData = {
  advisorEmployeeId: string;
  periodKey: string;
  periodLabel: string;
  /** Weighted composite attainment 0–100 over metrics that have data; null = nothing to measure yet. */
  compositePct: number | null;
  metrics: AdvisorScoreMetric[];
  closed: number;
  goal: number;
  hasGoal: boolean;
  hasData: boolean;
  /** Company-wide closed-$ rank + field size (for the sanctioned motivation medal). */
  rank: number | null;
  rankOf: number;
};

// Day-of-month by which this month's goal should be committed to count as "on time".
const GOAL_ON_TIME_DAY = 5;

/** Build the advisor scorecard for one advisor + month, from existing ledger data. */
export async function buildAdvisorScorecard(advisorEmployeeId: string, periodKey: string): Promise<AdvisorScorecardData> {
  const [standing, g, focusItems] = await Promise.all([
    advisorStanding(advisorEmployeeId, periodKey),
    advisorGoal(advisorEmployeeId, periodKey),
    listFocusItems(advisorEmployeeId, periodKey),
  ]);
  const f = standing.me; // AdvisorFunnel | null
  const pace = salesPace(periodKey);

  const metrics: AdvisorScoreMetric[] = [];

  // 1) Sales attainment — closed $ vs $ goal (pace-aware caption, scored full-month).
  const goal = f?.goal ?? 0;
  const closed = f?.closed ?? 0;
  const hasGoal = !!f?.hasGoal && goal > 0;
  metrics.push({
    key: "attainment",
    label: "Sales attainment",
    weight: 40,
    kind: "usd",
    value: hasGoal ? closed : null,
    target: hasGoal ? goal : null,
    attainment: hasGoal ? closed / goal : null,
    detail: hasGoal
      ? `${Math.round((closed / goal) * 100)}% of the $${Math.round(goal).toLocaleString()} goal · pace ${Math.round(pace * 100)}% through the month`
      : "Set a monthly $ goal to track attainment.",
  });

  // 2) Close rate — proposals → closed (count) vs target.
  const pcHas = !!f && f.hasData && f.pcTarget > 0;
  metrics.push({
    key: "close_rate",
    label: "Close rate",
    weight: 20,
    kind: "pct",
    value: pcHas ? (f!.pcRate * 100) : null,
    target: pcHas ? (f!.pcTarget * 100) : null,
    attainment: pcHas ? (f!.pcRate / f!.pcTarget) : null,
    detail: pcHas
      ? `${f!.deals} of ${f!.proposals} proposals closed vs a ${Math.round(f!.pcTarget * 100)}% target`
      : "Log proposals and closes to measure your close rate.",
  });

  // 3) Funnel conversion — leads → proposals vs target.
  const lpHas = !!f && f.hasData && f.lpTarget > 0;
  metrics.push({
    key: "funnel_conversion",
    label: "Funnel conversion",
    weight: 15,
    kind: "pct",
    value: lpHas ? (f!.lpRate * 100) : null,
    target: lpHas ? (f!.lpTarget * 100) : null,
    attainment: lpHas ? (f!.lpRate / f!.lpTarget) : null,
    detail: lpHas
      ? `${f!.proposals} proposals from ${f!.leads} leads vs a ${Math.round(f!.lpTarget * 100)}% target`
      : "Log leads and proposals to measure lead-to-proposal conversion.",
  });

  // 4) Goal set on time — a committed goal in place by the 5th of the month.
  const onTime = goalSetOnTime(g.sheet, periodKey);
  metrics.push({
    key: "goal_on_time",
    label: "Goal set on time",
    weight: 10,
    kind: "bool",
    value: onTime.attainment,
    target: onTime.attainment == null ? null : 1,
    attainment: onTime.attainment,
    detail: onTime.detail,
  });

  // 5) Focus-plan follow-through — actions with a logged outcome.
  const total = focusItems.length;
  const done = focusItems.filter((i) => i.status === "outcome_logged" || i.status === "closed").length;
  metrics.push({
    key: "focus_followthrough",
    label: "Focus-plan follow-through",
    weight: 15,
    kind: "count",
    value: total > 0 ? done : null,
    target: total > 0 ? total : null,
    attainment: total > 0 ? done / total : null,
    detail: total > 0
      ? `${done} of ${total} focus action${total === 1 ? "" : "s"} followed through with a logged outcome`
      : "Add Focus Plan actions and log their outcomes to track follow-through.",
  });

  // Weighted composite over the metrics that have data (re-normalized), each capped
  // at 100% so one over-performing line can't mask misses elsewhere.
  const scored = metrics.filter((m) => m.attainment != null);
  const wsum = scored.reduce((s, m) => s + m.weight, 0);
  const compositePct = wsum > 0
    ? Math.round(scored.reduce((s, m) => s + Math.min(1, m.attainment as number) * m.weight, 0) / wsum * 100)
    : null;

  return {
    advisorEmployeeId,
    periodKey,
    periodLabel: periodLabel(periodKey),
    compositePct,
    metrics,
    closed,
    goal,
    hasGoal,
    hasData: !!f?.hasData,
    rank: f && f.closed > 0 ? standing.ranks.company.closed : null,
    rankOf: standing.ranks.company.total,
  };
}

/** Whether a committed goal was in place by the 5th. null when still pending (don't penalize). */
function goalSetOnTime(
  sheet: { salesGoal: number; createdAt: Date } | null,
  periodKey: string,
): { attainment: number | null; detail: string } {
  const [y, m] = periodKey.split("-").map(Number);
  const deadline = new Date(Date.UTC(y, (m || 1) - 1, GOAL_ON_TIME_DAY, 23, 59, 59));
  const committed = !!sheet && sheet.salesGoal > 0;

  if (committed) {
    const onTime = sheet!.createdAt.getTime() <= deadline.getTime();
    return {
      attainment: onTime ? 1 : 0,
      detail: onTime
        ? `Committed by the ${GOAL_ON_TIME_DAY}th — on time`
        : `Goal committed after the ${GOAL_ON_TIME_DAY}th`,
    };
  }
  // No committed goal yet: pending (not a miss) while we're still before the deadline.
  if (Date.now() <= deadline.getTime()) {
    return { attainment: null, detail: `No committed goal yet — due by the ${GOAL_ON_TIME_DAY}th` };
  }
  return { attainment: 0, detail: `No committed goal set by the ${GOAL_ON_TIME_DAY}th` };
}
