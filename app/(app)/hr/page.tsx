import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";
import { allReviews } from "@/lib/review";
import { employeeRoster } from "@/lib/people";
import MyReviewsCard from "@/components/MyReviewsCard";
import { formerEmployees } from "@/lib/separation";
import { canManagePreHire, listPreHires } from "@/lib/prehire";
import {
  canManageAts, listJobs, candidatesAwaitingDecision, overdueInterviews, jobsAwaitingCloseout,
} from "@/lib/ats";
import { canViewAllPto, pendingRequestsForBranch } from "@/lib/pto";
import { outstandingMedicalNoteCount } from "@/lib/absence";
import { handbookAckRoster } from "@/lib/policy-docs";

export const dynamic = "force-dynamic";

export default async function HrHomePage() {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  // HR command center — HR flag holders + admins only.
  if (!(user.role === "admin" || user.hrAccess)) redirect(homePath(user));

  const canPto = canViewAllPto(user);
  const canAts = canManageAts(user);
  const canPreHire = canManagePreHire(user);
  const hr = isHrDirector(user);

  // Actionable queues (each gated by the same guard as its destination page).
  const [
    ptoPending, calloutNotes, jobs, candidatesAwaiting, overdueInt,
    preHires, reviews, former, ackRoster, closeoutJobs, roster,
  ] = await Promise.all([
    canPto ? pendingRequestsForBranch(null) : Promise.resolve([]),
    canPto ? outstandingMedicalNoteCount(null) : Promise.resolve(0),
    canAts ? listJobs() : Promise.resolve([]),
    canAts ? candidatesAwaitingDecision() : Promise.resolve([]),
    canAts ? overdueInterviews() : Promise.resolve([]),
    canPreHire ? listPreHires() : Promise.resolve([]),
    hr ? allReviews() : Promise.resolve([]),
    hr ? formerEmployees() : Promise.resolve([]),
    canPto || hr ? handbookAckRoster() : Promise.resolve({ version: 0, rows: [] }),
    canAts ? jobsAwaitingCloseout() : Promise.resolve([]),
    employeeRoster(),
  ]);

  const openJobs = jobs.filter((j) => j.status === "open").length;
  const reviewsNeedAction = reviews.filter((r) => r.status === "due" || r.status === "pending_approval").length;
  const preHiresToApprove = preHires.filter((p) => p.status === "submitted").length;
  const ackOutstanding = ackRoster.rows.filter((r) => !r.acknowledged).length;
  const ackTotal = ackRoster.rows.length;
  const ackDone = ackTotal - ackOutstanding;
  const activeHeadcount = roster.length;

  // Ordered by how time-sensitive each queue is.
  const actions: ActionItem[] = [
    canPto ? { href: "/management/people/pto", label: "PTO requests to review", count: ptoPending.length, tone: "amber" } : null,
    hr ? { href: "/management/people/reviews", label: "New-hire reviews need action", count: reviewsNeedAction, tone: "red" } : null,
    canAts ? { href: "/management/people/jobs", label: "Candidates awaiting decision", count: candidatesAwaiting.length, tone: "amber" } : null,
    canAts ? { href: "/management/people/jobs", label: "Overdue interviews", count: overdueInt.length, tone: "red" } : null,
    canPreHire ? { href: "/management/people/prehires", label: "Pre-hires awaiting approval", count: preHiresToApprove, tone: "amber" } : null,
    canPto ? { href: "/management/people/callouts", label: "Call-out notes outstanding", count: calloutNotes, tone: "amber" } : null,
    (canPto || hr) ? { href: "/management/people/handbook", label: "Handbook acks outstanding", count: ackOutstanding, tone: "slate" } : null,
    canAts ? { href: "/management/people/jobs", label: "Jobs awaiting closeout", count: closeoutJobs.length, tone: "slate" } : null,
  ].filter((a): a is ActionItem => a !== null);

  const totalOpen = actions.reduce((s, a) => s + a.count, 0);
  const needAttention = actions.filter((a) => a.count > 0).sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.count - a.count);

  return (
    <>
      <PageHeader
        title="HR Command Center"
        subtitle={totalOpen > 0 ? `${totalOpen} item${totalOpen === 1 ? "" : "s"} across your queues need attention` : "You're all caught up — no open HR items"}
        actions={
          <div className="flex items-center gap-3 text-sm font-medium">
            <Link href="/management/people" className="text-brand-700 hover:underline">Employee roster →</Link>
          </div>
        }
      />

      <MyReviewsCard userId={user.id} />

      {/* Snapshot stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active employees" value={String(activeHeadcount)} href="/management/people" />
        <Stat label="Open positions" value={String(openJobs)} href="/management/people/jobs" tone={openJobs > 0 ? "emerald" : undefined} />
        <Stat label="Awaiting onboarding" value={String(preHiresToApprove)} href="/management/people/prehires" tone={preHiresToApprove > 0 ? "amber" : undefined} />
        <Stat
          label="Handbook signed"
          value={ackTotal > 0 ? `${Math.round((ackDone / ackTotal) * 100)}%` : "—"}
          href="/management/people/handbook"
          tone={ackOutstanding > 0 ? "amber" : "emerald"}
        />
      </div>

      {/* Needs attention */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Needs your attention</div>
      {needAttention.length === 0 ? (
        <Card className="mb-6 flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
            <Icon d="M20 6L9 17l-5-5" />
          </span>
          <div>
            <div className="text-sm font-medium text-ink">Nothing needs your attention right now.</div>
            <div className="text-xs text-muted">New PTO requests, reviews, and hiring actions will show up here.</div>
          </div>
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {needAttention.map((a, i) => (
            <ActionCard key={`${a.href}-${i}`} {...a} />
          ))}
        </div>
      )}

      {/* All HR areas */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">HR areas</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {hr ? (
          <HrTile href="/management/people/reviews" title="New-hire reviews" hint="30 & 60-day reviews — signatures, approval"
            icon={<Icon d="M9 11l3 3 8-8M20 4v7m0 0h-7M4 20h6M4 16h10M4 12h4" />}
            badge={reviewsNeedAction > 0 ? { text: `${reviewsNeedAction} need action`, tone: "red" } : undefined} />
        ) : null}
        {canPto ? (
          <HrTile href="/management/people/pto" title="PTO overview" hint="Balances, calendar & approvals — company-wide"
            icon={<Icon d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1zM9 14l2 2 4-4" />}
            badge={ptoPending.length > 0 ? { text: `${ptoPending.length} to review`, tone: "amber" } : undefined} />
        ) : null}
        {canPto ? (
          <HrTile href="/management/people/callouts" title="Call-out overview" hint="Unplanned absences, notes & patterns"
            icon={<Icon d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1zM9 13l2 2 4-4" />}
            badge={calloutNotes > 0 ? { text: `${calloutNotes} note${calloutNotes === 1 ? "" : "s"} due`, tone: "amber" } : undefined} />
        ) : null}
        {canAts ? (
          <HrTile href="/management/people/jobs" title="Hiring / Jobs" hint="Post jobs, move candidates, interview to offer"
            icon={<Icon d="M9 7a4 4 0 108 0 4 4 0 00-8 0zM3 20v-1a5 5 0 015-5h4M16 11l2 2 4-4M20 14v5a1 1 0 01-1 1h-4" />}
            badge={openJobs > 0 ? { text: `${openJobs} open`, tone: "emerald" } : undefined} />
        ) : null}
        {canAts ? (
          <HrTile href="/management/people/hiring-templates" title="Hiring templates" hint="Interview & screening question libraries"
            icon={<Icon d="M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM14 3v5h5M8 13h8M8 17h5" />} />
        ) : null}
        {canPreHire ? (
          <HrTile href="/management/people/prehires" title="Pre-hires / onboarding" hint="Online onboarding, then convert to employee"
            icon={<Icon d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" />}
            badge={preHiresToApprove > 0 ? { text: `${preHiresToApprove} to approve`, tone: "amber" } : undefined} />
        ) : null}
        {(canPto || hr) ? (
          <HrTile href="/management/people/handbook" title="Handbook acknowledgments" hint="Who's signed, who's outstanding, signing links"
            icon={<Icon d="M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM14 3v5h5M9 13h6M9 17h6" />}
            badge={ackOutstanding > 0 ? { text: `${ackOutstanding} outstanding`, tone: "slate" } : undefined} />
        ) : null}
        <HrTile href="/management/people" title="Employee roster" hint="All personnel profiles by branch"
          icon={<Icon d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-4a3 3 0 11-3-3" />} />
        {hr ? (
          <HrTile href="/management/people/inactive" title="Former employees" hint="Separations & exit interviews — retained" iconTone="slate"
            icon={<Icon d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-2a4 4 0 014-4h4M17 17l4 4m0-4l-4 4" />}
            badge={{ text: `${former.length}`, tone: "slate" }} />
        ) : null}
        {user.role === "admin" ? (
          <HrTile href="/management/people/org" title="Org chart" hint="Reporting structure & team assignments"
            icon={<Icon d="M12 3v4m0 0a2 2 0 100 4 2 2 0 000-4zM6 21v-2a2 2 0 012-2h8a2 2 0 012 2v2M6 13a2 2 0 100 4 2 2 0 000-4zm12 0a2 2 0 100 4 2 2 0 000-4z" />} />
        ) : null}
      </div>
    </>
  );
}

type Tone = "red" | "amber" | "emerald" | "slate";
type ActionItem = { href: string; label: string; count: number; tone: Tone };

const TONE_RANK: Record<Tone, number> = { red: 0, amber: 1, emerald: 2, slate: 3 };

const BADGE_TONE: Record<string, string> = {
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-emerald-100 text-emerald-700",
  slate: "bg-slate-100 text-slate-600",
};

const STAT_TONE: Record<string, string> = {
  amber: "text-amber-600",
  emerald: "text-emerald-600",
};

function Stat({ label, value, href, tone }: { label: string; value: string; href: string; tone?: "amber" | "emerald" }) {
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:border-brand-200">
        <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
        <div className={`mt-1 text-2xl font-light tabular-nums ${tone ? STAT_TONE[tone] : ""}`}>{value}</div>
      </Card>
    </Link>
  );
}

function ActionCard({ href, label, count, tone }: ActionItem) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand-200 hover:bg-black/[0.02]">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-lg font-semibold tabular-nums ${BADGE_TONE[tone]}`}>{count}</span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink group-hover:text-brand-700">{label}</div>
        <div className="text-xs text-muted">Open →</div>
      </div>
    </Link>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function HrTile({
  href, title, hint, icon, iconTone = "brand", badge,
}: {
  href: string;
  title: string;
  hint: string;
  icon: ReactNode;
  iconTone?: "brand" | "slate";
  badge?: { text: string; tone: Tone };
}) {
  const iconCls = iconTone === "slate" ? "bg-slate-100 text-slate-500" : "bg-brand-100 text-brand-700";
  return (
    <Link href={href} className="group flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand-200 hover:bg-black/[0.02]">
      <div className="flex items-start justify-between gap-2">
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${iconCls}`}>{icon}</span>
        {badge ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[badge.tone]}`}>{badge.text}</span> : null}
      </div>
      <div>
        <div className="text-sm font-medium text-ink group-hover:text-brand-700">{title}</div>
        <div className="text-xs text-muted line-clamp-1">{hint}</div>
      </div>
    </Link>
  );
}
