// ─────────────────────────────────────────────────────────────────────────────
// Operating-rhythm ribbon helper (CanopyOS Theme 3).
//
// Makes the company operating cadence explicit per role: a compact
// "Today · This week · This month · This quarter" ribbon where each horizon lists
// the few cadence items/counts due in it, derived from the SAME due-date logic the
// command centers already compute. These builders are PURE — each role page hands
// in the handful of counts/flags it already has on hand (checklist done? scorecard
// scored? advisors behind pace?) and gets back serializable segments — so the
// ribbon never issues its own queries or drifts from the page's numbers.
// ─────────────────────────────────────────────────────────────────────────────

export type RhythmHorizon = "today" | "week" | "month" | "quarter";

export type RhythmStatus = "done" | "due" | "overdue" | "info";

export type RhythmItem = {
  key: string;
  label: string;
  href?: string;
  /** Short right-aligned value, e.g. "3/5", "Signed", "$12k of $40k". */
  meta?: string;
  status: RhythmStatus;
};

export type RhythmSegment = {
  horizon: RhythmHorizon;
  /** "Today", "This week", "This month", "This quarter". */
  label: string;
  /** The concrete period, e.g. "Fri, Oct 17", "Week of Oct 13", "October", "Q4 2026". */
  dateLabel: string;
  items: RhythmItem[];
};

const HORIZON_LABEL: Record<RhythmHorizon, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
};

/** Monday (UTC) of the week containing `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7; // Mon=0
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

/** The four concrete period labels for `now` (UTC, locale-formatted). */
export function rhythmDateLabels(now: Date): Record<RhythmHorizon, string> {
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  return {
    today: now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
    week: `Week of ${mondayOf(now).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`,
    month: now.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
    quarter: `Q${quarter} ${now.getUTCFullYear()}`,
  };
}

/** Assemble four segments from a horizon→items map, filling empty horizons. */
function assemble(now: Date, byHorizon: Partial<Record<RhythmHorizon, RhythmItem[]>>): RhythmSegment[] {
  const labels = rhythmDateLabels(now);
  const order: RhythmHorizon[] = ["today", "week", "month", "quarter"];
  return order.map((h) => ({
    horizon: h,
    label: HORIZON_LABEL[h],
    dateLabel: labels[h],
    items: byHorizon[h] ?? [],
  }));
}

// ── Per-role builders ────────────────────────────────────────────────────────

export type BranchRhythmInput = {
  now: Date;
  quarter: number;
  weeklyChecklistDone: boolean;
  weeklyChecklistHref: string;
  inspections: { completed: number; total: number } | null;
  warehouseDone: boolean;
  qcLogged: boolean;
  training: { done: number; total: number } | null;
  scorecard: { scored: number; of: number; pct: number };
  openAttention: number;
};

/** Branch manager rhythm: daily attention · weekly oversight · monthly duties ·
 *  quarterly scorecard. */
export function buildBranchRhythm(i: BranchRhythmInput): RhythmSegment[] {
  const today: RhythmItem[] = [
    i.openAttention > 0
      ? { key: "b_today_attn", label: "Items need attention", href: "#needs-attention", meta: String(i.openAttention), status: "due" }
      : { key: "b_today_clear", label: "Nothing outstanding today", meta: "Clear", status: "done" },
  ];
  const week: RhythmItem[] = [
    {
      key: "b_weekly", label: "Weekly oversight checklist", href: i.weeklyChecklistHref,
      meta: i.weeklyChecklistDone ? "Signed" : "Not signed",
      status: i.weeklyChecklistDone ? "done" : "due",
    },
  ];
  const month: RhythmItem[] = [];
  if (i.inspections && i.inspections.total > 0)
    month.push({
      key: "b_insp", label: "Vehicle inspections", href: "/my-branch/inspections",
      meta: `${i.inspections.completed}/${i.inspections.total}`,
      status: i.inspections.completed >= i.inspections.total ? "done" : "due",
    });
  month.push({
    key: "b_wh", label: "Warehouse inspection", href: "/my-branch/warehouse",
    meta: i.warehouseDone ? "Logged" : "Not logged", status: i.warehouseDone ? "done" : "due",
  });
  month.push({
    key: "b_qc", label: "Quality control reports", href: "/my-branch/qc",
    meta: i.qcLogged ? "Logged" : "Due", status: i.qcLogged ? "done" : "due",
  });
  if (i.training && i.training.total > 0)
    month.push({
      key: "b_train", label: "Onboarding / CEU training", href: "/my-branch/training",
      meta: `${i.training.done}/${i.training.total}`,
      status: i.training.done >= i.training.total ? "done" : "due",
    });
  const quarter: RhythmItem[] = [
    {
      key: "b_score", label: `Q${i.quarter} scorecard`, href: "/my-branch/scorecard",
      meta: i.scorecard.of > 0 ? `${i.scorecard.scored}/${i.scorecard.of} scored` : "—",
      status: i.scorecard.scored >= i.scorecard.of && i.scorecard.of > 0 ? "done" : "info",
    },
  ];
  return assemble(i.now, { today, week, month, quarter });
}

export type InventoryRhythmInput = {
  now: Date;
  reorderCount: number;
  toConfirm: number;
  monthSpendLabel: string;
  monthBudgetPct: number | null;
  openAlerts: number;
};

/** Inventory (admin) home rhythm: daily reorder/confirm · monthly spend-vs-budget. */
export function buildInventoryRhythm(i: InventoryRhythmInput): RhythmSegment[] {
  const today: RhythmItem[] = [];
  today.push(
    i.reorderCount > 0
      ? { key: "i_reorder", label: "Products to reorder", href: "/alerts", meta: String(i.reorderCount), status: "due" }
      : { key: "i_reorder_ok", label: "Stock cover healthy", meta: "Clear", status: "done" },
  );
  if (i.toConfirm > 0)
    today.push({ key: "i_confirm", label: "Products to confirm", href: "/manage/confirm", meta: String(i.toConfirm), status: "due" });
  const week: RhythmItem[] = [
    i.openAlerts > 0
      ? { key: "i_alerts", label: "Open inventory alerts", href: "/alerts", meta: String(i.openAlerts), status: "due" }
      : { key: "i_alerts_ok", label: "No open alerts", meta: "Clear", status: "done" },
  ];
  const month: RhythmItem[] = [
    {
      key: "i_spend", label: "Spend vs budget", href: "/dashboard", meta: i.monthSpendLabel,
      status: i.monthBudgetPct != null && i.monthBudgetPct > 100 ? "overdue" : "info",
    },
  ];
  const quarter: RhythmItem[] = [
    { key: "i_quarter", label: "Quarter purchasing review", href: "/reports", meta: "Reports", status: "info" },
  ];
  return assemble(i.now, { today, week, month, quarter });
}

export type HrRhythmInput = {
  now: Date;
  ptoPending: number;
  overdueInterviews: number;
  reviewsNeedAction: number;
  candidatesAwaiting: number;
  preHiresToApprove: number;
  calloutNotes: number;
  ackOutstanding: number;
  ackPct: number | null;
};

/** HR command-center rhythm. */
export function buildHrRhythm(i: HrRhythmInput): RhythmSegment[] {
  const today: RhythmItem[] = [];
  today.push(
    i.ptoPending > 0
      ? { key: "hr_pto", label: "PTO requests to review", href: "/management/people/pto", meta: String(i.ptoPending), status: "due" }
      : { key: "hr_pto_ok", label: "No PTO to review", meta: "Clear", status: "done" },
  );
  if (i.overdueInterviews > 0)
    today.push({ key: "hr_int", label: "Overdue interviews", href: "/management/people/jobs", meta: String(i.overdueInterviews), status: "overdue" });
  const week: RhythmItem[] = [];
  if (i.reviewsNeedAction > 0)
    week.push({ key: "hr_rev", label: "New-hire reviews need action", href: "/management/people/reviews", meta: String(i.reviewsNeedAction), status: "due" });
  if (i.candidatesAwaiting > 0)
    week.push({ key: "hr_cand", label: "Candidates awaiting decision", href: "/management/people/jobs", meta: String(i.candidatesAwaiting), status: "due" });
  if (week.length === 0) week.push({ key: "hr_week_ok", label: "Nothing due this week", meta: "Clear", status: "done" });
  const month: RhythmItem[] = [];
  if (i.preHiresToApprove > 0)
    month.push({ key: "hr_prehire", label: "Pre-hires to onboard", href: "/management/people/prehires", meta: String(i.preHiresToApprove), status: "due" });
  if (i.calloutNotes > 0)
    month.push({ key: "hr_callout", label: "Call-out notes outstanding", href: "/management/people/callouts", meta: String(i.calloutNotes), status: "due" });
  month.push({
    key: "hr_ack", label: "Handbook acknowledgments", href: "/management/people/handbook",
    meta: i.ackPct != null ? `${i.ackPct}% signed` : "—",
    status: i.ackOutstanding > 0 ? "due" : "done",
  });
  const quarter: RhythmItem[] = [
    { key: "hr_quarter", label: "Roster & org review", href: "/management/people", meta: "Review", status: "info" },
  ];
  return assemble(i.now, { today, week, month, quarter });
}

export type FieldOpsRhythmInput = {
  now: Date;
  quarter: number;
  overdueFollowUps: number;
  openFollowUps: number;
  vehiclesDue: number;
  warehouseMissing: number;
  warehouseTotal: number;
  auditsMissing: number;
  auditsTotal: number;
};

/** Field-ops director rhythm. */
export function buildFieldOpsRhythm(i: FieldOpsRhythmInput): RhythmSegment[] {
  const today: RhythmItem[] = [
    i.overdueFollowUps > 0
      ? { key: "fo_overdue", label: "Audit follow-ups overdue", href: "/management/audits", meta: String(i.overdueFollowUps), status: "overdue" }
      : { key: "fo_today_ok", label: "No overdue follow-ups", meta: "Clear", status: "done" },
  ];
  const week: RhythmItem[] = [
    {
      key: "fo_vehicles", label: "Vehicles due for service", href: "/fleet",
      meta: String(i.vehiclesDue), status: i.vehiclesDue > 0 ? "due" : "done",
    },
    {
      key: "fo_followups", label: "Open audit follow-ups", href: "/management/audits",
      meta: String(i.openFollowUps), status: i.openFollowUps > 0 ? "due" : "done",
    },
  ];
  const month: RhythmItem[] = [
    {
      key: "fo_wh", label: "Warehouse inspections", href: "/management/compliance",
      meta: `${i.warehouseTotal - i.warehouseMissing}/${i.warehouseTotal}`,
      status: i.warehouseMissing > 0 ? "due" : "done",
    },
  ];
  const quarter: RhythmItem[] = [
    {
      key: "fo_audits", label: `Q${i.quarter} branch audits`, href: "/management/audits",
      meta: `${i.auditsTotal - i.auditsMissing}/${i.auditsTotal}`,
      status: i.auditsMissing > 0 ? "due" : "done",
    },
    { key: "fo_scorecards", label: "Manager scorecards", href: "/management/scorecards", meta: "Review", status: "info" },
  ];
  return assemble(i.now, { today, week, month, quarter });
}

export type ExecutiveRhythmInput = {
  now: Date;
  quarter: number;
  overdueFollowUps: number;
  missedChecklists: number;
  mbrMissing: boolean;
  mbrMonthLabel: string;
  warehouseMissing: number;
  warehouseTotal: number;
  auditsMissing: number;
  auditsTotal: number;
  renewals: number;
};

/** Executive (COO/board) rhythm — the leadership cadence. */
export function buildExecutiveRhythm(i: ExecutiveRhythmInput): RhythmSegment[] {
  const today: RhythmItem[] = [];
  if (i.overdueFollowUps > 0)
    today.push({ key: "ex_overdue", label: "Audit follow-ups overdue", href: "/management/audits", meta: String(i.overdueFollowUps), status: "overdue" });
  if (i.missedChecklists > 0)
    today.push({ key: "ex_miss", label: "Missed weekly checklists", href: "/checklists/oversight", meta: String(i.missedChecklists), status: "overdue" });
  if (today.length === 0) today.push({ key: "ex_today_ok", label: "No escalations today", meta: "Clear", status: "done" });
  const week: RhythmItem[] = [
    {
      key: "ex_wh", label: "Warehouse inspections", href: "/management/compliance",
      meta: `${i.warehouseTotal - i.warehouseMissing}/${i.warehouseTotal}`,
      status: i.warehouseMissing > 0 ? "due" : "done",
    },
  ];
  const month: RhythmItem[] = [
    {
      key: "ex_mbr", label: `${i.mbrMonthLabel} MBR`, href: "/management/upload",
      meta: i.mbrMissing ? "Upload" : "Posted", status: i.mbrMissing ? "due" : "done",
    },
    {
      key: "ex_renew", label: "Insurance / license renewals", href: "/management/insurance",
      meta: String(i.renewals), status: i.renewals > 0 ? "due" : "done",
    },
  ];
  const quarter: RhythmItem[] = [
    {
      key: "ex_audits", label: `Q${i.quarter} branch audits`, href: "/management/audits",
      meta: `${i.auditsTotal - i.auditsMissing}/${i.auditsTotal}`,
      status: i.auditsMissing > 0 ? "due" : "done",
    },
    { key: "ex_scorecards", label: "Manager scorecard sign-offs", href: "/management/scorecards", meta: "Review", status: "info" },
  ];
  return assemble(i.now, { today, week, month, quarter });
}

export type SalesRhythmInput = {
  now: Date;
  periodLabel: string;
  overdueFollowUps: number;
  behindPace: number;
  goalsSet: number;
  advisors: number;
  closed: number;
  goal: number;
  awaitingApproval: number;
};

/** Sales director rhythm. */
export function buildSalesRhythm(i: SalesRhythmInput): RhythmSegment[] {
  const money0 = (n: number) => `$${Math.round(n / 1000)}k`;
  const today: RhythmItem[] = [
    i.overdueFollowUps > 0
      ? { key: "s_overdue", label: "Focus follow-ups overdue", href: "/sales#focus-followups", meta: String(i.overdueFollowUps), status: "overdue" }
      : { key: "s_today_ok", label: "No overdue follow-ups", meta: "Clear", status: "done" },
  ];
  const week: RhythmItem[] = [
    {
      key: "s_behind", label: "Advisors behind pace", href: "/sales",
      meta: String(i.behindPace), status: i.behindPace > 0 ? "due" : "done",
    },
  ];
  if (i.awaitingApproval > 0)
    week.push({ key: "s_approve", label: "Goals awaiting approval", href: "/sales", meta: String(i.awaitingApproval), status: "due" });
  const month: RhythmItem[] = [
    {
      key: "s_goals", label: "Advisors with a goal set", href: "/sales",
      meta: `${i.goalsSet}/${i.advisors}`, status: i.goalsSet >= i.advisors && i.advisors > 0 ? "done" : "due",
    },
  ];
  if (i.goal > 0)
    month.push({
      key: "s_closed", label: "Closed vs team goal", href: "/sales",
      meta: `${money0(i.closed)} of ${money0(i.goal)}`, status: i.closed >= i.goal ? "done" : "info",
    });
  const quarter: RhythmItem[] = [
    { key: "s_quarter", label: "Quarter sales trend", href: "/management/sales", meta: "Review", status: "info" },
  ];
  return assemble(i.now, { today, week, month, quarter });
}

export type EmployeeRoutineInput = { key: string; label: string; cadence: "daily" | "weekly" | "monthly" | "quarterly"; href?: string };

export type EmployeeRhythmInput = {
  now: Date;
  routines: EmployeeRoutineInput[];
  openTraining: number;
  trainingOverdue: boolean;
  reviewsToSign: number;
  interviews: number;
};

/** Employee / technician rhythm — their recurring routines by cadence plus the
 *  personal items due now. */
export function buildEmployeeRhythm(i: EmployeeRhythmInput): RhythmSegment[] {
  const CAD: Record<string, RhythmHorizon> = { daily: "today", weekly: "week", monthly: "month", quarterly: "quarter" };
  const byHorizon: Record<RhythmHorizon, RhythmItem[]> = { today: [], week: [], month: [], quarter: [] };
  for (const r of i.routines)
    byHorizon[CAD[r.cadence]].push({ key: `r_${r.key}`, label: r.label, href: r.href, status: "info" });

  if (i.interviews > 0)
    byHorizon.today.push({ key: "e_int", label: "Interviews to complete", href: "/me", meta: String(i.interviews), status: "due" });
  if (i.reviewsToSign > 0)
    byHorizon.week.push({ key: "e_rev", label: "New-hire reviews to sign", href: "/me", meta: String(i.reviewsToSign), status: "due" });
  if (i.openTraining > 0)
    byHorizon.month.push({
      key: "e_train", label: "Training to finish", href: "/me/training",
      meta: String(i.openTraining), status: i.trainingOverdue ? "overdue" : "due",
    });

  // Fill empties so the ribbon always reads as a complete cadence.
  for (const h of ["today", "week", "month", "quarter"] as RhythmHorizon[])
    if (byHorizon[h].length === 0) byHorizon[h].push({ key: `e_${h}_ok`, label: "Nothing due", meta: "Clear", status: "done" });

  return assemble(i.now, byHorizon);
}
