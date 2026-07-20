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

      {hr ? (
        <Link href="/management/people/reviews" className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-black/[0.02]">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-100 text-brand-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 8-8M20 4v7m0 0h-7M4 20h6M4 16h10M4 12h4" /></svg>
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium text-ink">New-hire reviews</span>
            <span className="block text-xs text-muted">30 & 60-day reviews — assign reviewers, track signatures, final approval</span>
          </span>
          {reviewsNeedAction > 0 ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{reviewsNeedAction} need action</span> : null}
          <span className="text-muted text-sm">→</span>
        </Link>
      ) : null}

      {canPto ? (
        <Link href="/management/people/pto" className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-black/[0.02]">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-100 text-brand-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1zM9 14l2 2 4-4" /></svg>
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium text-ink">PTO overview</span>
            <span className="block text-xs text-muted">Everyone&rsquo;s balances &amp; allotments, the real-time time-off calendar, pending approvals & decision history — company-wide</span>
          </span>
          {ptoPending.length > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{ptoPending.length} to review</span> : null}
          <span className="text-muted text-sm">→</span>
        </Link>
      ) : null}

      {canPto ? (
        <Link href="/management/people/handbook" className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-black/[0.02]">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-100 text-brand-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM14 3v5h5M9 13h6M9 17h6" /></svg>
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium text-ink">Handbook acknowledgments</span>
            <span className="block text-xs text-muted">Who has signed the current Employee Handbook, who&rsquo;s outstanding, and generate a per-employee signing link</span>
          </span>
          <span className="text-muted text-sm">→</span>
        </Link>
      ) : null}

      {canAts ? (
        <Link href="/management/people/jobs" className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-black/[0.02]">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-100 text-brand-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 7a4 4 0 108 0 4 4 0 00-8 0zM3 20v-1a5 5 0 015-5h4M16 11l2 2 4-4M20 14v5a1 1 0 01-1 1h-4" /></svg>
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium text-ink">Hiring / Jobs</span>
            <span className="block text-xs text-muted">Post jobs, move candidates through the pipeline, assign interviews with scorecards, then onboard</span>
          </span>
          {openJobs > 0 ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">{openJobs} open</span> : null}
          <span className="text-muted text-sm">→</span>
        </Link>
      ) : null}

      {canPreHire ? (
        <Link href="/management/people/prehires" className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-black/[0.02]">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-100 text-brand-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" /></svg>
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium text-ink">Pre-hires / onboarding</span>
            <span className="block text-xs text-muted">Invite candidates, they complete onboarding online, then approve to convert into an employee</span>
          </span>
          <span className="text-muted text-sm">→</span>
        </Link>
      ) : null}

      {hr ? (
        <Link href="/management/people/inactive" className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-black/[0.02]">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-500">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-2a4 4 0 014-4h4M17 17l4 4m0-4l-4 4" /></svg>
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium text-ink">Former employees</span>
            <span className="block text-xs text-muted">Terminated / departed staff — separation records & exit interviews, all data retained</span>
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{former.length}</span>
          <span className="text-muted text-sm">→</span>
        </Link>
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
