import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { pendingRequestsForBranch, ptoTypeLabel } from "@/lib/pto";
import { managerReminders, type Reminder } from "@/lib/reminders";
import { reviewsForReviewer, REVIEW_LABEL } from "@/lib/review";
import { listEmployees } from "@/lib/people";
import { listVehicles } from "@/lib/fleet";
import { inspectionStatus } from "@/lib/inspection";
import { checklistStatusForBranch, sweepMissedChecklists, openMisses, fridayLabel, endOfMonthLabel, fridayEndOf, endOfMonth } from "@/lib/checklists";
import RemindersCard from "@/components/RemindersCard";
import BulletinBanner from "@/components/BulletinBanner";
import ComposeThread from "@/components/ComposeThread";
import { openFollowUps } from "@/lib/audit";
import { warehouseStatus } from "@/lib/warehouse";
import { SCORECARD_METRICS, savedResults, weightedScore } from "@/lib/scorecard";
import FollowUps from "./FollowUps";

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

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const quarter = Math.floor((month - 1) / 3) + 1;

  const [reminders, insp, openAlerts, followUps, myReviews, ptoPending] = await Promise.all([
    managerReminders(branch ?? undefined),
    inspectionStatus(year, month, branch ?? undefined),
    prisma.alert.count({ where: { status: "open" } }),
    openFollowUps(branch ?? undefined),
    reviewsForReviewer(user.id),
    // Pending PTO awaiting review — the same signal shown on the team page.
    // Branch-locked managers see their branch; admins see everyone.
    pendingRequestsForBranch(branch),
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
  // Recurring oversight sign-offs (the weekly attested checklist).
  const checklistStatuses = await checklistStatusForBranch(scBranch, now);
  const weekly = checklistStatuses.find((s) => s.template.cadence === "weekly") ?? null;
  // Missed-checklist penalty: detect lazily (no cron), then surface open misses
  // for this branch as a red banner. Managers can see them but never clear them.
  await sweepMissedChecklists();
  const branchMisses = await openMisses(branch ?? undefined);
  // CEU/training: complete when the branch has assignments and none are open.
  const openTraining = await prisma.trainingAssignment.count({ where: { status: { not: "completed" }, ...(branch ? { branch } : {}) } });
  const totalTraining = await prisma.trainingAssignment.count({ where: branch ? { branch } : undefined });
  const trainingDone = totalTraining > 0 && openTraining === 0;
  const saved = await savedResults(year, quarter, scBranch);
  const metState = Object.fromEntries(SCORECARD_METRICS.map((m) => [m.key, saved[m.key]?.met ?? null]));
  const scScore = weightedScore(metState);
  const scScored = SCORECARD_METRICS.filter((m) => metState[m.key] != null).length;

  const scopeLabel = branch ? branchLabel(branch) : "All branches";

  // Employee + vehicle pick lists for the "+ Reminder" pop-up.
  const [remEmployees, remVehicles] = await Promise.all([
    listEmployees(branch ?? undefined),
    listVehicles(branch ?? undefined, "active"),
  ]);
  const employeeOpts = remEmployees.map((e) => ({ id: e.id, label: `${e.name}${e.branch ? ` · ${branchLabel(e.branch)}` : ""}` }));
  const vehicleOpts = remVehicles.map((v) => ({ id: v.id, label: `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}` }));

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name?.split(" ")[0] ?? "Manager"}`}
        subtitle={`${scopeLabel} · ${MONTHS[month]} ${year} — your monthly checklist & what needs attention`}
      />

      <BulletinBanner />

      {locked ? null : (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
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
            {branchMisses.length} missed weekly checklist{branchMisses.length === 1 ? "" : "s"} on record.
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
        <Tile label="Open alerts" value={String(openAlerts)} tone={openAlerts ? "warn" : "good"} href="/alerts" />
        <Tile label={`Q${quarter} scorecard`} value={`${scScore}%`} sub={`${scScored}/${SCORECARD_METRICS.length} scored`} href={`/my-branch/scorecard?branch=${scBranch}&year=${year}&quarter=${quarter}`} />
      </div>

      {/* Manager Checklist — every recurring compliance cadence in ONE place, each
          flagged Weekly/Monthly with its due date + a live countdown. Anything
          outstanding is red; anything due within a day turns the row light-red. */}
      <Card className="p-0 overflow-hidden mb-5" data-testid="manager-checklist">
        <div className="px-4 py-3 border-b border-line">
          <div className="text-sm font-medium text-ink">Manager Checklist</div>
          <p className="text-xs text-muted mt-0.5">Every recurring duty in one place — stay ahead of each due date. Outstanding items are flagged in red.</p>
        </div>
        <ul className="divide-y divide-line">
          {[
            {
              label: "Weekly Oversight Checklist",
              href: `/checklists/weekly?branch=${scBranch}`,
              done: !!weekly?.completed,
              status: weekly?.completed && weekly.completion ? `✓ Signed by ${weekly.completion.signedName}` : "Not yet signed",
              cadence: "Weekly" as const,
              due: fridayEndOf(now),
              dueLabel: fridayLabel(now),
            },
            {
              label: "Vehicle Inspections",
              href: "/my-branch/inspections",
              done: insp.pending === 0,
              status: insp.total > 0 ? `${insp.completed}/${insp.total} completed` : "No vehicles assigned",
              cadence: "Monthly" as const,
              due: endOfMonth(now),
              dueLabel: endOfMonthLabel(now),
            },
            {
              label: "Warehouse safety inspection",
              href: "/my-branch/warehouse",
              done: warehouse.done,
              status: warehouse.done ? "Logged this month" : "Not logged yet",
              cadence: "Monthly" as const,
              due: endOfMonth(now),
              dueLabel: endOfMonthLabel(now),
            },
            {
              label: "Quality control reports",
              href: "/my-branch/qc",
              done: false,
              status: "Not logged yet",
              cadence: "Monthly" as const,
              due: endOfMonth(now),
              dueLabel: endOfMonthLabel(now),
            },
            {
              label: "Onboarding / CEU training",
              href: "/my-branch/training",
              done: totalTraining === 0 || trainingDone,
              status: totalTraining === 0 ? "None assigned" : trainingDone ? "All current" : `${openTraining} outstanding`,
              cadence: "Monthly" as const,
              due: endOfMonth(now),
              dueLabel: endOfMonthLabel(now),
            },
          ].map((row) => (
            <ManagerChecklistRow key={row.label} {...row} now={now} />
          ))}
        </ul>
      </Card>

      {/* Needs attention — event-driven items only (fleet maintenance,
          registrations, custom reminders). Inspections live in the checklist;
          audit items have their own card below, so nothing repeats. */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-ink">Needs attention</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">{attention.length} item{attention.length === 1 ? "" : "s"}</span>
            <RemindersCard mode="button" employees={employeeOpts} vehicles={vehicleOpts} />
          </div>
        </div>
        {attention.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nothing outstanding — you&rsquo;re all caught up. 🎉</p>
        ) : (
          <ul className="divide-y divide-line">
            {attention.slice(0, 12).map((r, i) => (
              <ReminderRow key={i} r={r} showBranch={branch === null} />
            ))}
          </ul>
        )}
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

function ReminderRow({ r, showBranch }: { r: Reminder; showBranch: boolean }) {
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
      <div className="shrink-0 self-center">
        <ComposeThread
          variant="link"
          label="Discuss"
          context={{ type: "reminder", label: r.title, href: r.href, subject: `Re: ${r.title}` }}
        />
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
  label, href, done, status, cadence, due, dueLabel, now,
}: {
  label: string; href: string; done: boolean; status: string;
  cadence: "Weekly" | "Monthly"; due: Date; dueLabel: string; now: Date;
}) {
  const n = daysUntilCal(due, now);
  const overdue = n < 0;
  // Urgency escalates the whole row once it's within a day of due (or overdue).
  const urgent = !done && n <= 1;
  const countdown = done
    ? null
    : overdue
      ? `Overdue by ${-n} day${n === -1 ? "" : "s"}`
      : n === 0 ? "Due today" : n === 1 ? "Due tomorrow" : `Due in ${n} days`;
  return (
    <li>
      <Link href={href} className={`flex items-center gap-3 px-4 py-3.5 ${urgent ? "bg-red-50 hover:bg-red-100" : "hover:bg-black/[0.02]"}`}>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${done ? "bg-brand-100 text-brand-700" : urgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{done ? "✓" : "!"}</span>
        <span className="flex-1 min-w-0">
          <span className={`block text-sm font-medium ${done ? "text-ink" : "text-red-600"}`}>{label}</span>
          <span className={`block text-xs ${done ? "text-brand-600" : "text-red-600"}`}>{status}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block"><FreqBadge>{cadence}</FreqBadge></span>
          <span className="mt-1 block text-[11px] text-muted">Due by {dueLabel}</span>
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
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-white shadow" : "text-muted hover:text-ink"}`}>
      {label}
    </Link>
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
