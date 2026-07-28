import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, isBoardObserver, scopedBranch, branchLocked } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";
import { allReviews } from "@/lib/review";
import { BRANCHES, branchLabel } from "@/lib/management";
import { employeeRoster } from "@/lib/people";
import { formerEmployees } from "@/lib/separation";
import { canManagePreHire } from "@/lib/prehire";
import { canManageAts, listJobs } from "@/lib/ats";
import { canViewAllPto, pendingRequestsForBranch } from "@/lib/pto";
import { outstandingMedicalNoteCount } from "@/lib/absence";
import PeopleControls from "./PeopleControls";

export const dynamic = "force-dynamic";

function gradeChip(grade: string | null) {
  if (!grade) return "bg-black/5 text-muted";
  return grade === "A" || grade === "B" ? "bg-emerald-100 text-emerald-700" : grade === "C" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const locked = branchLocked(user);
  const hr = isHrDirector(user);
  const canPreHire = canManagePreHire(user);
  const canAts = canManageAts(user);
  const canPto = canViewAllPto(user);
  const ptoPending = canPto ? await pendingRequestsForBranch(null) : [];
  const calloutNotes = canPto ? await outstandingMedicalNoteCount(null) : 0;
  const jobs = canAts ? await listJobs() : [];
  const openJobs = jobs.filter((j) => j.status === "open").length;
  const roster = await employeeRoster(branch ?? undefined);
  const reviews = hr ? await allReviews() : [];
  const reviewsNeedAction = reviews.filter((r) => r.status === "due" || r.status === "pending_approval").length;
  const former = hr ? await formerEmployees(branch ?? undefined) : [];

  return (
    <>
      <PageHeader title="People / HR" subtitle="Personnel profiles — inspection & review history by branch" />

      {hr ? <PeopleControls defaultBranch={branch} /> : null}

      {(hr || canPto || canAts || canPreHire) ? (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
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
          {canPreHire ? (
            <HrTile href="/management/people/prehires" title="Pre-hires / onboarding" hint="Online onboarding, then convert to employee"
              icon={<Icon d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" />} />
          ) : null}
          {canPto ? (
            <HrTile href="/management/people/handbook" title="Handbook acknowledgments" hint="Who's signed, who's outstanding, signing links"
              icon={<Icon d="M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM14 3v5h5M9 13h6M9 17h6" />} />
          ) : null}
          {hr ? (
            <HrTile href="/management/people/inactive" title="Former employees" hint="Separations & exit interviews — retained" iconTone="slate"
              icon={<Icon d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-2a4 4 0 014-4h4M17 17l4 4m0-4l-4 4" />}
              badge={{ text: `${former.length}`, tone: "slate" }} />
          ) : null}
        </div>
      ) : null}

      {locked ? null : (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <Pill href="/management/people" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <Pill key={b.key} href={`/management/people?branch=${b.key}`} label={b.label} active={branch === b.key} />
          ))}
        </div>
      )}

      {roster.length === 0 ? (
        <EmptyState title="No employees" hint="Employees load from the personnel seed." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Division</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium text-right">Inspections</th>
                  <th className="px-4 py-2 font-medium text-center">Avg grade</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/management/people/${e.id}`} className="text-brand-700 hover:underline">{e.name}</Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{e.role ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{e.division ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{e.branch ? branchLabel(e.branch) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{e.inspectionCount}</td>
                    <td className="px-4 py-2 text-center">
                      {e.grade ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${gradeChip(e.grade)}`}>{e.grade}</span>
                          <span className="text-xs text-muted tabular-nums">{e.avgPct}%</span>
                        </span>
                      ) : <span className="text-xs text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Pill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>
      {label}
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

const BADGE_TONE: Record<string, string> = {
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-emerald-100 text-emerald-700",
  slate: "bg-slate-100 text-slate-600",
};

function HrTile({
  href,
  title,
  hint,
  icon,
  iconTone = "brand",
  badge,
}: {
  href: string;
  title: string;
  hint: string;
  icon: React.ReactNode;
  iconTone?: "brand" | "slate";
  badge?: { text: string; tone: "red" | "amber" | "emerald" | "slate" };
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
