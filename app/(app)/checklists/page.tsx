import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { checklistStatusForBranch, fridayLabel, endOfMonthLabel } from "@/lib/checklists";

export const dynamic = "force-dynamic";

const DATE = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function frequency(cadence: string): string {
  return cadence === "weekly" ? "Weekly" : "Monthly";
}
function dueDate(cadence: string, now: Date): string {
  return cadence === "weekly" ? `Due ${fridayLabel(now)}` : `Due ${endOfMonthLabel(now)}`;
}

export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested) ?? (branchLocked(user) ? null : BRANCHES[0].key);
  const locked = branchLocked(user);

  if (!branch) {
    return (
      <>
        <PageHeader title="Oversight checklists" subtitle="Your recurring weekly & monthly sign-offs" />
        <EmptyState title="No branch to show" hint="Your account isn't tied to a branch." />
      </>
    );
  }

  const now = new Date();
  const statuses = await checklistStatusForBranch(branch, now);

  return (
    <>
      <PageHeader
        title="Oversight checklists"
        subtitle={`${branchLabel(branch)} · complete each period top to bottom, then sign off`}
      />

      {locked ? null : (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          {BRANCHES.map((b) => (
            <Link
              key={b.key}
              href={`/checklists?branch=${b.key}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${branch === b.key ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}
            >
              {b.label}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {statuses.map((s) => {
          const tone = s.completed ? "good" : s.overdue ? "bad" : "warn";
          const border = tone === "good" ? "ring-1 ring-emerald-200" : tone === "bad" ? "ring-1 ring-red-200" : "ring-1 ring-amber-200";
          return (
            <Card key={s.template.key} className={`p-0 overflow-hidden ${border}`}>
              <div className="px-5 py-4 border-b border-line">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-medium text-ink">{s.template.title}</div>
                    <div className="text-xs text-muted mt-0.5">{s.periodLabel}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 text-right shrink-0">
                    <StatusBadge completed={s.completed} overdue={s.overdue} />
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">{frequency(s.template.cadence)}</span>
                    <span className="text-[11px] text-muted">{dueDate(s.template.cadence, now)}</span>
                  </div>
                </div>
                {s.template.intro ? <p className="text-sm text-muted mt-2">{s.template.intro}</p> : null}
              </div>
              <div className="px-5 py-4">
                {s.completed && s.completion ? (
                  <p className="text-sm text-brand-700">
                    Signed by <span className="font-medium">{s.completion.signedName}</span> on {DATE(s.completion.createdAt)}.
                  </p>
                ) : (
                  <p className="text-sm text-muted">Not yet completed for this period.</p>
                )}
                <Link
                  href={`/checklists/${s.template.key}?branch=${branch}`}
                  className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-[filter] ${s.completed ? "border border-[#cfe0d6] bg-white text-[#0e1b15] hover:bg-[#eef5f0]" : "bg-emerald-grad text-[#05271c] shadow-sm shadow-brand-600/30 hover:brightness-[0.97]"}`}
                >
                  {s.completed ? "View signed record" : "Start / complete"}
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function StatusBadge({ completed, overdue }: { completed: boolean; overdue: boolean }) {
  if (completed) return <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">✓ Done</span>;
  if (overdue) return <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">Overdue</span>;
  return <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">Due</span>;
}
