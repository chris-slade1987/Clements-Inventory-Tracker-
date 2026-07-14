import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { listEmployees } from "@/lib/people";

export const dynamic = "force-dynamic";

// NOTE — future build: Monthly CEU / onboarding training.
// When this is built out it must:
//   1. Capture each technician's completion of the month's training assignment.
//   2. Link that completion back to the manager in charge of the branch, so it
//      counts toward the manager's "Onboarding / CEU training" scorecard item.
//   3. Show, on this dashboard, which employees HAVE and HAVE NOT completed the
//      assignment (the roster preview below is the intended layout).
export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const branch = scopedBranch(user, BRANCHES.find((b) => b.key === sp.branch)?.key ?? null);
  const employees = await listEmployees(branch ?? undefined);

  const now = new Date();
  const monthName = now.toLocaleString("en-US", { month: "long" });

  return (
    <>
      <PageHeader title="Onboarding / CEU Training" subtitle={`${branch ? branchLabel(branch) : "All branches"} · ${monthName} ${now.getFullYear()} training completion`} />

      <Card className="p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-sm font-medium text-ink">Monthly training completion</div>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-muted">Coming soon</span>
        </div>
        <p className="text-sm text-muted">
          The monthly CEU / onboarding training module will track each technician&rsquo;s completion of the
          month&rsquo;s assignment, roll it up to the branch manager for their <strong className="text-ink">Onboarding / CEU Training</strong> scorecard
          item, and show here exactly who has and hasn&rsquo;t completed it — so managers can chase down the stragglers.
        </p>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Staff — {monthName} training status <span className="text-xs font-normal text-muted">(preview)</span></div>
        {employees.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No employees for this branch.</p>
        ) : (
          <ul className="divide-y divide-line">
            {employees.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 text-sm text-ink">{e.name}<span className="ml-2 text-xs text-muted">{e.role ?? ""}{e.branch ? ` · ${branchLabel(e.branch)}` : ""}</span></span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium text-muted">Not recorded yet</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
