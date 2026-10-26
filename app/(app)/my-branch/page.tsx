import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { pendingRequestsForBranch, ptoTypeLabel } from "@/lib/pto";
import { collectAttention, type AttentionItem } from "@/lib/needs-attention";
import { buildBranchRhythm } from "@/lib/rhythm";
import RhythmRibbon from "@/components/RhythmRibbon";
import { INVENTORY_ALERT_TYPES } from "@/lib/anomaly";
import { reviewsForReviewer, REVIEW_LABEL } from "@/lib/review";
import { listEmployees } from "@/lib/people";
import { listVehicles } from "@/lib/fleet";
import { inspectionStatus } from "@/lib/inspection";
import { sweepMissedChecklists, openMisses, fridayLabel, endOfMonthLabel, fridayEndOf, endOfMonth } from "@/lib/checklists";
import { getCurrentBranchWeekSummary } from "@/lib/branch-command";
import { getRoutingSummary, sweepMissedRouting, routingDueDate } from "@/lib/routing";
import RemindersCard from "@/components/RemindersCard";
import BulletinBanner from "@/components/BulletinBanner";
import ComposeThread from "@/components/ComposeThread";
import ClearReminderButton from "@/components/ClearReminderButton";
import { openFollowUps } from "@/lib/audit";
import { warehouseStatus } from "@/lib/warehouse";
import { SCORECARD_METRICS, savedResults, weightedScore } from "@/lib/scorecard";
import FollowUps from "./FollowUps";
import MyBranchViewToggle from "./MyBranchViewToggle";
import { AchievementBar, ProgressRing, encouragement } from "@/components/motivation";
import AskCanopy from "@/components/AskCanopy";
import WeatherTile from "@/components/WeatherTile";
import { listProductionPeriods, getBranchProductionMonth } from "@/lib/branch-production-ingest";

export const dynamic = "force-dynamic";

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function MyBranchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const locked = branchLocked(user);

  // Route-completion glance → deep-links to Branch Command. Prefer the CURRENT month
  // (matching Branch Command's default) so the two surfaces never show different figures;
  // fall back to the most-recent loaded month.
  const prodPeriods = branch ? await listProductionPeriods(branch) : [];
  const glanceMonthKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const glancePeriod = prodPeriods.includes(glanceMonthKey) ? glanceMonthKey : prodPeriods[0];
  const prodGlance = branch && glancePeriod ? await getBranchProductionMonth(branch, glancePeriod) : null;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const quarter = Math.floor((month - 1) / 3) + 1;

  const [reminders, insp, openAlerts, followUps, myReviews, ptoPending] = await Promise.all([
    collectAttention({ user, audience: "branch", branch: branch ?? undefined, now }),
    inspectionStatus(year, month, branch ?? undefined),
    // Company inventory-alert count — only needed for the non-locked (admin)
    // all-branch view; branch-locked managers don't show this tile.
    locked ? Promise.resolve(0) : prisma.alert.count({ where: { status: { in: ["open", "acknowledged"] }, type: { in: [...INVENTORY_ALERT_TYPES] } } }),
    openFollowUps(branch ?? undefined),
    reviewsForReviewer(user.id),
    // Pending PTO awaiting review — the same signal shown on the team page.
    // Branch-locked managers see their branch; admins see everyone. Manager-level
    // requests are hidden here because they're routed to HR for approval.
    pendingRequestsForBranch(branch, { excludeManagerPlus: true }),
  ]);
  const nowMs = now.getTime();

  // The recurring monthly duties (vehicle inspections, warehouse, QC, training)
  // live in the checklist below; audit items have their own resolvable card.
  // "Needs attention" is only the event-driven items that aren't shown elsewhere,
  // so nothing is listed three times.
  const attention = reminders.filter(
    (r) => r.kind !== "inspection_due" && r.kind !== "warehouse_due" && r.kind !== "audit_followup"
  );

  const followUpItems = followUps.map((f) => ({
    id: f.id,
    description: f.description,
    dueDate: f.dueDate ? f.dueDate.toISOString() : null,
    quarter: f.audit.quarter,
    year: f.audit.year,
    overdue: !!f.dueDate && f.dueDate.getTime() < nowMs,
  }));

  // Scorecard snapshot — current quarter, for the selected branch (or the first
  // branch when viewing all, just to show progress).
  const scBranch = branch ?? BRANCHES[0].key;
  const warehouse = await warehouseStatus(year, month, scBranch);
  // Weekly oversight sign-off now lives in Branch Command (a signed BranchWeek).
  const bwSummary = await getCurrentBranchWeekSummary(scBranch, now);
  const routingSummary = await getRoutingSummary(scBranch);
  const routingDue = routingDueDate(routingSummary.periodKey);
  const routingOverdue = routingSummary.loaded && !routingSummary.signed && now.getTime() > routingDue.getTime();
  // Missed-oversight penalty: detect lazily (no cron), then surface open misses
  // for this branch as a red banner. Managers can see them but never clear them.
  await sweepMissedChecklists();
  await sweepMissedRouting();
  const branchMisses = await openMisses(branch ?? undefined);
  // CEU/training: complete when the branch has assignments and none are open.
  const openTraining = await prisma.trainingAssignment.count({ where: { status: { not: "completed" }, ...(branch ? { branch } : {}) } });
  const totalTraining = await prisma.trainingAssignment.count({ where: branch ? { branch } : undefined });
  const trainingDone = totalTraining > 0 && openTraining === 0;
  const saved = await savedResults(year, quarter, scBranch);
  const metState = Object.fromEntries(SCORECARD_METRICS.map((m) => [m.key, saved[m.key]?.met ?? null]));
  const scScore = weightedScore(metState);
  const scScored = SCORECARD_METRICS.filter((m) => metState[m.key] != null).length;

  // This period's recurring duties, for the momentum bar (only the ones with a
  // real signal — QC has no completion feed yet, so it's left out rather than
  // counted as always-incomplete).
  const duties: boolean[] = [
    bwSummary.signed,
    ...(insp.total > 0 ? [insp.pending === 0] : []),
    warehouse.done,
    ...(totalTraining > 0 ? [trainingDone] : []),
  ];
  const dutiesDone = duties.filter(Boolean).length;

  const scopeLabel = branch ? branchLabel(branch) : "All branches";

  // Employee + vehicle pick lists for the "+ Reminder" pop-up.
  const [remEmployees, remVehicles] = await Promise.all([
    listEmployees(branch ?? undefined),
    listVehicles(branch ?? undefined, "active"),
  ]);
  const employeeOpts = remEmployees.map((e) => ({ id: e.id, label: `${e.name}${e.branch ? ` · ${branchLabel(e.branch)}` : ""}` }));
  const vehicleOpts = remVehicles.map((v) => ({ id: v.id, label: `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}` }));

  // Operating-rhythm ribbon — this branch's cadence, from the duties already read above.
  const rhythm = buildBranchRhythm({
    now,
    quarter,
    weeklyChecklistDone: bwSummary.signed,
    weeklyChecklistHref: `/branch-command?branch=${scBranch}`,
    routing: routingSummary.exists
      ? { loaded: routingSummary.loaded, signed: routingSummary.signed, overdue: routingOverdue, href: `/routing-approval?branch=${scBranch}` }
      : null,
    inspections: insp.total > 0 ? { completed: insp.completed, total: insp.total } : null,
    warehouseDone: warehouse.done,
    qcLogged: false,
    training: totalTraining > 0 ? { done: totalTraining - openTraining, total: totalTraining } : null,
    scorecard: { scored: scScored, of: SCORECARD_METRICS.length, pct: scScore },
    openAttention: attention.length,
  });

  // ---- Unified "What needs you" worklist -------------------------------------
  // One SLA-sorted list that merges the recurring compliance cadence with the
  // event-driven attention items, so a manager reads one prioritized queue instead
  // of synthesizing across two cards. Overdue/urgent float to the top; done and
  // not-yet-tracked settle to the bottom. (PTO approvals, new-hire reviews and audit
  // follow-ups stay as their own queues below — they're distinct, not cadence/alerts.)
  type CadenceRow = {
    label: string; href: string; done: boolean; status: string;
    cadence: "Weekly" | "Monthly"; due: Date; dueLabel: string; tracked?: boolean;
  };
  const cadence: CadenceRow[] = [
    { label: "Branch Command (weekly review)", href: `/branch-command?branch=${scBranch}`, done: bwSummary.signed, status: bwSummary.signed ? `Signed by ${bwSummary.signedName ?? "manager"}` : "Not yet signed", cadence: "Weekly", due: fridayEndOf(now), dueLabel: fridayLabel(now) },
    { label: "Routing Approval", href: `/routing-approval?branch=${scBranch}`, done: routingSummary.signed, status: !routingSummary.loaded ? "Routing not loaded yet" : routingSummary.signed ? "Signed off" : `${routingSummary.approved}/${routingSummary.techs} techs approved`, cadence: "Monthly", due: routingDue, dueLabel: `Due ${routingDue.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (first week)` },
    { label: "Vehicle Inspections", href: "/my-branch/inspections", done: insp.pending === 0, status: insp.total > 0 ? `${insp.completed}/${insp.total} completed` : "No vehicles assigned", cadence: "Monthly", due: endOfMonth(now), dueLabel: endOfMonthLabel(now) },
    { label: "Warehouse safety inspection", href: "/my-branch/warehouse", done: warehouse.done, status: warehouse.done ? "Logged this month" : "Not logged yet", cadence: "Monthly", due: endOfMonth(now), dueLabel: endOfMonthLabel(now) },
    // QC has no completion feed yet, so it renders neutral (never a permanent red SLA).
    { label: "Quality control reports", href: "/my-branch/qc", done: false, tracked: false, status: "Not yet tracked", cadence: "Monthly", due: endOfMonth(now), dueLabel: endOfMonthLabel(now) },
    { label: "Onboarding / CEU training", href: "/my-branch/training", done: totalTraining === 0 || trainingDone, status: totalTraining === 0 ? "None assigned" : trainingDone ? "All current" : `${openTraining} outstanding`, cadence: "Monthly", due: endOfMonth(now), dueLabel: endOfMonthLabel(now) },
  ];
  // Quarterly branch audit — surfaces only once the Director of Field Ops has
  // routed one to this branch for the current quarter. The manager signs via the
  // tokenized link; a signed one links to the filed form.
  const auditRow = scBranch
    ? await prisma.branchAudit.findFirst({
        where: { branch: scBranch, year, quarter, status: { in: ["pending_manager", "submitted", "signed"] } },
        select: { id: true, status: true, managerSignToken: true, managerSignedName: true },
      })
    : null;
  if (auditRow) {
    const signed = auditRow.status === "signed";
    cadence.push({
      label: "Quarterly branch audit (sign-off)",
      href: signed || !auditRow.managerSignToken ? `/management/audits/${auditRow.id}` : `/audit-sign/${auditRow.managerSignToken}`,
      done: signed,
      status: signed ? `Signed by ${auditRow.managerSignedName ?? "manager"}` : "Awaiting manager signature",
      cadence: "Monthly", due: endOfMonth(now), dueLabel: "Director of Field Ops visit",
    });
  }

  const cadScore = (r: CadenceRow) => (r.done ? 1000 : r.tracked === false ? 900 : daysUntilCal(r.due, now));
  const attnScore = (a: AttentionItem) => (a.severity === "critical" ? -50 : a.severity === "warning" ? 5 : 15);
  const worklist: ({ sort: number } & ({ k: "cadence"; row: CadenceRow } | { k: "attn"; a: AttentionItem }))[] = [
    ...cadence.map((row) => ({ sort: cadScore(row), k: "cadence" as const, row })),
    ...attention.map((a) => ({ sort: attnScore(a), k: "attn" as const, a })),
  ].sort((x, y) => x.sort - y.sort);
  const openWork = worklist.filter((it) => (it.k === "cadence" ? !it.row.done && it.row.tracked !== false : true)).length;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name?.split(" ")[0] ?? "Manager"}`}
        subtitle={`${scopeLabel} · ${MONTHS[month]} ${year} — your monthly checklist & what needs attention`}
      />

      <MyBranchViewToggle view="todos" branchQuery={branch ? `?branch=${branch}` : ""} />

      {/* Weather Ops — today's conditions + what it means for pest pressure, front and
          center. Branch-locked managers see their territory; admins see all four.
          Loads from the scoped /api/weather so it never blocks the dashboard render. */}
      <WeatherTile canSeeAll={!locked} />

      {prodGlance && prodGlance.routes.length > 0 ? (
        <Link href={branch ? `/branch-command?branch=${branch}` : "/branch-command"} className="mb-5 block rounded-xl border border-line bg-surface p-4 hover:shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wide text-muted">Route completion · {prodGlance.periodKey}</div>
            <span className="text-xs text-brand-600">Review in Branch Command →</span>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-2xl font-light tabular-nums text-ink">{prodGlance.totals.completionPct}%<span className="ml-1 text-xs text-muted">complete</span></span>
            <span className={`text-lg font-light tabular-nums ${prodGlance.totals.leftBehind > 0 ? "text-red-600" : "text-brand-600"}`}>{prodGlance.totals.leftBehind}<span className="ml-1 text-xs text-muted">jobs left behind (${Math.round(prodGlance.totals.leftBehindDollars).toLocaleString()})</span></span>
            <span className="text-lg font-light tabular-nums text-ink">{prodGlance.totals.remaining}<span className="ml-1 text-xs text-muted">remaining</span></span>
            {prodGlance.totals.callbacks > 0 && <span className="text-lg font-light tabular-nums text-amber-600">{prodGlance.totals.callbacks}<span className="ml-1 text-xs text-muted">callbacks</span></span>}
          </div>
        </Link>
      ) : null}

      <BulletinBanner />

      <RhythmRibbon segments={rhythm} />

      {/* Momentum — this period's compliance at a glance, on the encouragement
          ramp (motivation kit). Built from data already on the page; nothing is
          invented where there's no feed (QC is omitted). */}
      <Card className="p-4 mb-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <AchievementBar
              label="This period's duties complete"
              value={dutiesDone}
              target={duties.length}
              caption={`${dutiesDone} of ${duties.length} recurring duties · ${encouragement(duties.length > 0 ? (dutiesDone / duties.length) * 100 : 0)}`}
              size="lg"
              milestones={duties.map((_, i) => ({ at: ((i + 1) / duties.length) * 100 }))}
            />
          </div>
          <div className="flex items-center justify-around gap-5 sm:justify-start">
            {insp.total > 0 ? (
              <RingStat label="Inspections" value={insp.completed} target={insp.total} />
            ) : null}
            <RingStat label={`Q${quarter} scorecard`} value={scScore} target={100} />
            {totalTraining > 0 ? (
              <RingStat label="Training" value={totalTraining - openTraining} target={totalTraining} />
            ) : null}
          </div>
        </div>
      </Card>

      {locked ? null : (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/[0.06] p-1 w-fit">
          <BranchPill href="/my-branch" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <BranchPill key={b.key} href={`/my-branch?branch=${b.key}`} label={b.label} active={branch === b.key} />
          ))}
        </div>
      )}

      {/* Missed-checklist penalty — a visible, non-clearable infraction banner.
          Only HR or the CEO can clear a miss (enforced server-side). */}
      {branchMisses.length > 0 ? (
        <div className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3" data-testid="miss-banner">
          <div className="text-sm font-semibold text-red-700">
            {branchMisses.length} missed oversight item{branchMisses.length === 1 ? "" : "s"} on record (weekly Branch Command / monthly Routing Approval).
          </div>
          <div className="text-xs text-red-600 mt-0.5">
            Only HR or the CEO can clear these. {branchMisses.slice(0, 3).map((m) => m.periodLabel).join(", ")}
            {branchMisses.length > 3 ? ", …" : ""}
          </div>
        </div>
      ) : null}

      {/* PTO requests awaiting review — also shown on the team page. Branch-locked
          managers see their branch; admins see everyone. Clears once decided. */}
      {ptoPending.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5 ring-1 ring-amber-200">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div className="text-sm font-medium text-ink">PTO requests need review · {ptoPending.length}</div>
            <Link href="/my-branch/team" className="text-xs font-medium text-brand-700 hover:underline">Review →</Link>
          </div>
          <ul className="divide-y divide-line">
            {ptoPending.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                <span className="flex-1 text-sm text-ink">
                  {r.employee.name}
                  {r.employee.branch ? <span className="ml-2 text-[11px] font-normal text-muted">{branchLabel(r.employee.branch)}</span> : null}
                </span>
                <span className="text-xs text-muted">{r.days} {ptoTypeLabel(r.type).toLowerCase()} day{r.days === 1 ? "" : "s"} · {r.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Tiles */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Tile
          label="Vehicle inspections"
          value={`${insp.completed}/${insp.total}`}
          tone={insp.pending > 0 ? "warn" : "good"}
          sub={insp.pending > 0 ? `${insp.pending} outstanding` : "All done"}
          href="/my-branch/inspections"
        />
        <Tile label="Needs attention" value={String(attention.length)} tone={attention.some((r) => r.severity === "critical") ? "bad" : attention.length ? "warn" : "good"} sub={attention.length ? "Fleet & reminders" : "All clear"} />
        {/* The company inventory-alerts firehose is admin-only; a branch manager's
            branch items (incl. low-stock) are in "Needs attention" above. */}
        {!locked ? <Tile label="Open alerts" value={String(openAlerts)} tone={openAlerts ? "warn" : "good"} href="/alerts" /> : null}
        <Tile label={`Q${quarter} scorecard`} value={`${scScore}%`} sub={`${scScored}/${SCORECARD_METRICS.length} scored`} href={`/my-branch/scorecard?branch=${scBranch}&year=${year}&quarter=${quarter}`} />
      </div>

      {/* What needs you — the recurring compliance cadence AND the event-driven
          attention items, merged into ONE SLA-sorted queue (overdue/urgent first;
          done and not-yet-tracked settle to the bottom). Each attention item keeps
          its own Discuss/Clear actions. Replaces the former separate Manager
          Checklist + Needs-attention cards. */}
      <Card className="p-0 overflow-hidden mb-5" data-testid="manager-checklist">
        <div className="px-4 py-3 border-b border-line flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-ink">What needs you</div>
            <p className="text-xs text-muted mt-0.5">
              {openWork > 0 ? `${openWork} item${openWork === 1 ? "" : "s"} need action — most urgent first.` : "You're all caught up — nothing outstanding."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <RemindersCard mode="button" employees={employeeOpts} vehicles={vehicleOpts} />
            <AskCanopy
              task="Help me complete my Branch Command weekly review"
              label="Ask Canopy"
              context={`${scopeLabel} — ${MONTHS[month]} ${year} manager worklist`}
            />
          </div>
        </div>
        <ul className="divide-y divide-line">
          {worklist.map((it, i) =>
            it.k === "cadence" ? (
              <ManagerChecklistRow key={`c-${it.row.label}`} {...it.row} now={now} />
            ) : (
              <ReminderRow key={`a-${i}`} r={it.a} showBranch={branch === null} />
            ),
          )}
        </ul>
      </Card>

      {/* New-hire reviews this manager is conducting */}
      {myReviews.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">New-hire reviews to complete</div>
          <ul className="divide-y divide-line">
            {myReviews.map((r) => (
              <li key={r.id}>
                <Link href={`/reviews/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.dueDate.getTime() < nowMs ? "bg-red-500" : "bg-amber-500"}`} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{r.employee.name} — {REVIEW_LABEL[r.type]}</span>
                    <span className="block text-xs text-muted">
                      {r.status === "pending_approval" ? "Signed — awaiting HR approval" : r.reviewerSignedAt ? "You signed — awaiting employee" : "Complete & sign with the employee"}
                      {` · due ${r.dueDate.toLocaleDateString()}`}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-brand-700 mt-0.5">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Audit action items (resolvable) */}
      <FollowUps items={followUpItems} />
    </>
  );
}

function ReminderRow({ r, showBranch }: { r: AttentionItem; showBranch: boolean }) {
  const dot = r.severity === "critical" ? "bg-red-500" : r.severity === "warning" ? "bg-amber-500" : "bg-brand-400";
  return (
    <li className="flex items-start gap-2 pr-3">
      <Link href={r.href} className="flex flex-1 items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="flex-1">
          <span className="block text-sm font-medium text-ink">
            {r.title}
            {showBranch && r.branch ? <span className="ml-2 text-[11px] font-normal text-muted">{branchLabel(r.branch)}</span> : null}
          </span>
          <span className="block text-xs text-muted">{r.detail}</span>
        </span>
      </Link>
      <div className="shrink-0 self-center flex items-center gap-3">
        <ComposeThread
          variant="link"
          label="Discuss"
          context={{ type: "reminder", label: r.title, href: r.href, subject: `Re: ${r.title}` }}
        />
        <ClearReminderButton reminderKey={r.key} branch={r.branch} />
      </div>
    </li>
  );
}

// Whole calendar-day difference (UTC) from `now` to `due`: today=0, tomorrow=1,
// yesterday=-1. Ignores time-of-day so "due in N days" / "due today" read right.
function daysUntilCal(due: Date, now: Date): number {
  const d0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d1 = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((d1 - d0) / 86400000);
}

function ManagerChecklistRow({
  label, href, done, status, cadence, due, dueLabel, now, tracked = true,
}: {
  label: string; href: string; done: boolean; status: string;
  cadence: "Weekly" | "Monthly"; due: Date; dueLabel: string; now: Date; tracked?: boolean;
}) {
  const n = daysUntilCal(due, now);
  const overdue = tracked && n < 0;
  // Urgency escalates the whole row once it's within a day of due (or overdue).
  // An untracked item (no completion feed yet) is never urgent/overdue.
  const urgent = tracked && !done && n <= 1;
  const countdown = !tracked || done
    ? null
    : overdue
      ? `Overdue by ${-n} day${n === -1 ? "" : "s"}`
      : n === 0 ? "Due today" : n === 1 ? "Due tomorrow" : `Due in ${n} days`;
  // Neutral styling when untracked: never red, never an alert icon.
  const labelColor = !tracked ? "text-ink" : done ? "text-ink" : "text-red-600";
  const statusColor = !tracked ? "text-muted" : done ? "text-brand-600" : "text-red-600";
  const iconWrap = !tracked ? "bg-black/[0.05] text-muted" : done ? "bg-brand-100 text-brand-700" : urgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
  return (
    <li>
      <Link href={href} className={`flex items-center gap-3 px-4 py-3.5 ${urgent ? "bg-red-50 hover:bg-red-100" : "hover:bg-black/[0.02]"}`}>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${iconWrap}`}>
          {!tracked ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /></svg>
          ) : done ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5" /><path d="M12 16.5v.5" /></svg>
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className={`block text-sm font-medium ${labelColor}`}>{label}</span>
          <span className={`block text-xs ${statusColor}`}>{status}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block"><FreqBadge>{cadence}</FreqBadge></span>
          {tracked ? <span className="mt-1 block text-[11px] text-muted">Due by {dueLabel}</span> : <span className="mt-1 block text-[11px] text-muted">Not yet tracked</span>}
          {countdown ? <span className={`block text-[11px] font-medium ${urgent ? "text-red-600" : "text-muted"}`}>{countdown}</span> : null}
        </span>
      </Link>
    </li>
  );
}

function FreqBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
      {children}
    </span>
  );
}

function BranchPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-white shadow" : "text-ink/80 hover:text-ink hover:bg-black/[0.04]"}`}>
      {label}
    </Link>
  );
}

function RingStat({ label, value, target }: { label: string; value: number; target: number }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <ProgressRing value={value} target={target} size={58} stroke={7} ariaLabel={label} />
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}

function Tile({ label, value, sub, tone, href }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad"; href?: string }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  const inner = (
    <Card className="p-4 h-full">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
      {sub ? <div className="text-xs text-muted mt-0.5">{sub}</div> : null}
    </Card>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{inner}</Link> : inner;
}
