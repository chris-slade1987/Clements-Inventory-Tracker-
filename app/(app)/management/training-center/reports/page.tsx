import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { canViewCertifications } from "@/lib/certifications";
import { prisma } from "@/lib/prisma";
import { getModulesPerMonth } from "@/lib/training-assign";
import {
  assignmentsInProgress,
  stalledAssignments,
  pendingSignoffs,
  awardsByMonth,
  STALLED_DAYS,
} from "@/lib/training-center";
import TrainingCenterTabs from "@/components/TrainingCenterTabs";
import PacingControl from "./PacingControl";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training Reports — CanopyOS" };

const BRANCH_LABEL: Record<string, string> = { vero: "Vero Beach", stuart: "Stuart", orlando: "Orlando", naples: "Naples" };
const branchName = (b: string) => BRANCH_LABEL[b] ?? b;

export default async function TrainingReportsPage() {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }

  const [inProgress, stalled, pending, byMonth, pacing] = await Promise.all([
    assignmentsInProgress(),
    stalledAssignments(),
    pendingSignoffs(),
    awardsByMonth(),
    getModulesPerMonth(prisma),
  ]);

  return (
    <>
      <TrainingCenterTabs showCourses={user.role === "admin"} />
      <PageHeader title="Training reports" subtitle="Where training stands across the company: in-progress work, stalled assignments, sign-offs awaiting approval, and certifications earned." />

      {user.role === "admin" ? <PacingControl current={pacing} /> : null}

      {/* 1 — In progress by branch & module */}
      <Card className="mb-5 p-4">
        <div className="mb-3 text-sm font-semibold text-ink">Assignments in progress — by branch &amp; module</div>
        {inProgress.length === 0 ? (
          <p className="text-sm text-muted">No active module assignments.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Module</th>
                  <th className="px-3 py-2 font-medium text-right">In progress</th>
                </tr>
              </thead>
              <tbody>
                {inProgress.map((r) => (
                  <tr key={`${r.branch}-${r.moduleCode}`} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3 text-ink">{branchName(r.branch)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{r.moduleCode}</span>{" "}
                      <span className="text-muted">{r.moduleName}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 2 — Stalled */}
      <Card className="mb-5 p-4">
        <div className="mb-1 text-sm font-semibold text-ink">Overdue / stalled</div>
        <p className="mb-3 text-xs text-muted">Active assignments started more than {STALLED_DAYS} days ago with courses still incomplete.</p>
        {stalled.length === 0 ? (
          <p className="text-sm text-muted">Nothing stalled — every active assignment is recent or on track.</p>
        ) : (
          <div className="space-y-2">
            {stalled.map((r) => (
              <div key={r.assignmentId} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/management/training-center/employee/${r.employeeId}`} className="text-sm font-medium text-brand-700 hover:underline">
                    {r.employeeName}
                  </Link>
                  <span className="text-xs text-muted">
                    {r.moduleCode ?? "Single course"}
                    {r.branch ? ` · ${branchName(r.branch)}` : ""} · assigned {r.assignedAt} ({r.daysOld}d ago)
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">Outstanding: {r.outstanding.map((o) => o.code).join(", ")}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 3 — Pending field sign-offs */}
      <Card className="mb-5 p-4">
        <div className="mb-3 text-sm font-semibold text-ink">Field sign-offs awaiting a supervisor</div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">No sign-offs pending approval.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Trainer</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/management/training-center/employee/${s.employeeId}`} className="font-medium text-brand-700 hover:underline">
                        {s.employeeName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{s.branch ? branchName(s.branch) : "—"}</td>
                    <td className="px-3 py-2">{s.courseCode ?? s.certCode ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{s.date}</td>
                    <td className="px-3 py-2 text-muted">{s.trainerName ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/management/training-center/employee/${s.employeeId}`} className="text-xs font-medium text-brand-700 hover:underline">
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 4 — Awards by month */}
      <Card className="p-4">
        <div className="mb-3 text-sm font-semibold text-ink">Certifications awarded — by month</div>
        {byMonth.length === 0 ? (
          <EmptyState title="No certifications awarded yet" />
        ) : (
          <div className="space-y-3">
            {byMonth.map((m) => (
              <div key={m.month} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{m.month}</span>
                  <span className="text-xs text-muted tabular-nums">{m.count} awarded</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {m.certs.map((c, i) => (
                    <span key={i} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
                      <span className="font-semibold">{c.certCode}</span> · {c.employeeName}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
