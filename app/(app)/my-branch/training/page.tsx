import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { STATUS_LABEL } from "@/lib/training";
import { listEmployees } from "@/lib/people";
import Link from "next/link";

export const dynamic = "force-dynamic";

function statusChip(s: string) {
  const c = s === "completed" ? "bg-emerald-100 text-emerald-700" : s === "in_progress" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600";
  return `rounded-full px-2 py-0.5 text-[11px] font-medium ${c}`;
}

export default async function ManagerTrainingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const branch = scopedBranch(user, BRANCHES.find((b) => b.key === sp.branch)?.key ?? null);
  const locked = branchLocked(user);

  // Each employee at the branch with their assignments (started / not / completed).
  const employees = await listEmployees(branch ?? undefined);
  const assignments = await prisma.trainingAssignment.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) } },
    include: { course: { select: { title: true } } },
    orderBy: { assignedAt: "desc" },
  });
  const byEmp = new Map<string, typeof assignments>();
  for (const a of assignments) { const arr = byEmp.get(a.employeeId) ?? []; arr.push(a); byEmp.set(a.employeeId, arr); }

  const counts = {
    total: assignments.length,
    completed: assignments.filter((a) => a.status === "completed").length,
    inProgress: assignments.filter((a) => a.status === "in_progress").length,
    notStarted: assignments.filter((a) => a.status === "not_started").length,
  };

  return (
    <>
      <PageHeader title="CEUs / Training" subtitle={`${branch ? branchLabel(branch) : "All branches"} · who has started, not started, or completed`} />

      {!locked ? (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <Link href="/my-branch/training" className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${branch === null ? "bg-emerald-grad text-white shadow" : "text-muted hover:text-ink"}`}>All branches</Link>
          {BRANCHES.map((b) => <Link key={b.key} href={`/my-branch/training?branch=${b.key}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${branch === b.key ? "bg-emerald-grad text-white shadow" : "text-muted hover:text-ink"}`}>{b.label}</Link>)}
        </div>
      ) : null}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Tile label="Assignments" value={String(counts.total)} />
        <Tile label="Completed" value={String(counts.completed)} tone="good" />
        <Tile label="In progress" value={String(counts.inProgress)} tone="warn" />
        <Tile label="Not started" value={String(counts.notStarted)} tone={counts.notStarted ? "bad" : "good"} />
      </div>

      {employees.length === 0 ? (
        <EmptyState title="No employees" hint="No employees for this branch." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">By employee</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-4 py-2 font-medium">Assigned training</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const list = byEmp.get(e.id) ?? [];
                  return (
                    <tr key={e.id} className="border-b border-line last:border-0 align-top">
                      <td className="px-4 py-2 font-medium">{e.name}</td>
                      <td className="px-3 py-2 text-muted">{e.branch ? branchLabel(e.branch) : "—"}</td>
                      <td className="px-4 py-2">
                        {list.length === 0 ? <span className="text-xs text-muted">No assignments</span> : (
                          <div className="flex flex-wrap gap-1.5">
                            {list.map((a) => (
                              <span key={a.id} className={statusChip(a.status)} title={STATUS_LABEL[a.status]}>{a.course.title}{a.status === "completed" && a.score != null ? ` · ${a.score}%` : ` · ${STATUS_LABEL[a.status]}`}</span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
    </Card>
  );
}
