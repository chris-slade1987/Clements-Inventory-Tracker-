import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { managerReminders, type Reminder } from "@/lib/reminders";
import { reviewsForReviewer, REVIEW_LABEL } from "@/lib/review";
import { listEmployees } from "@/lib/people";
import { listVehicles } from "@/lib/fleet";
import { inspectionStatus } from "@/lib/inspection";
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

  const [reminders, insp, openAlerts, followUps, myReviews] = await Promise.all([
    managerReminders(branch ?? undefined),
    inspectionStatus(year, month, branch ?? undefined),
    prisma.alert.count({ where: { status: "open" } }),
    openFollowUps(branch ?? undefined),
    reviewsForReviewer(user.id),
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

      {/* This month's checklist — the single home for the recurring monthly duties
          that feed the quarterly scorecard. */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line">
          <div className="text-sm font-medium text-ink">This month&rsquo;s checklist</div>
          <p className="text-xs text-muted mt-0.5">Your recurring monthly duties. These feed your Q{quarter} scorecard.</p>
        </div>
        <ul className="divide-y divide-line">
          <ChecklistRow
            done={insp.total > 0 && insp.pending === 0}
            label="Vehicle inspections"
            detail={insp.total > 0 ? `${insp.completed} of ${insp.total} completed` : "No vehicles assigned"}
            href="/my-branch/inspections"
          />
          <ChecklistRow done={warehouse.done} label="Warehouse safety inspection" detail={warehouse.done ? "Logged this month" : "Not logged yet"} href="/my-branch/warehouse" />
          <ChecklistRow done={false} label="Quality control reports" detail="Not logged yet" href="/my-branch/qc" />
          <ChecklistRow done={trainingDone} label="Onboarding / CEU training" detail={totalTraining === 0 ? "None assigned" : trainingDone ? "All current" : `${openTraining} outstanding`} href="/my-branch/training" />
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

function ChecklistRow({ done, label, detail, href }: { done: boolean; label: string; detail: string; href: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02]">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${done ? "bg-brand-100 text-brand-700" : "bg-red-100 text-red-700"}`}>{done ? "✓" : "!"}</span>
        <span className="flex-1">
          <span className={`block text-sm font-medium ${done ? "text-brand-700" : "text-red-600"}`}>{label}</span>
          <span className="block text-xs text-muted">{detail}</span>
        </span>
        <span className={`text-[11px] font-medium ${done ? "text-brand-600" : "text-red-600"}`}>{done ? "Done" : "Action needed"}</span>
      </Link>
    </li>
  );
}

function BranchPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>
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
