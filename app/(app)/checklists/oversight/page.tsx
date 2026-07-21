import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { canClearChecklistMiss } from "@/lib/personnel";
import {
  rollup,
  sweepMissedChecklists,
  openMisses,
  clearedMisses,
  missCountsByBranch,
  type ChecklistStatus,
} from "@/lib/checklists";
import ChecklistMisses, { type MissDTO } from "../ChecklistMisses";

export const dynamic = "force-dynamic";

const DATE = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function ChecklistOversightPage() {
  const user = await requireUser();
  // Leadership rollup — admins + senior leadership only.
  if (user.role !== "admin" && !user.seniorLeadership) redirect("/my-branch");

  // Lazy, idempotent detection of any newly-elapsed missed weeks (no cron).
  await sweepMissedChecklists();

  const [{ columns, rows }, open, cleared, counts] = await Promise.all([
    rollup(new Date()),
    openMisses(),
    clearedMisses(),
    missCountsByBranch(),
  ]);

  const outstanding = rows.reduce(
    (n, r) => n + columns.filter((c) => r.statuses[c.id] && !r.statuses[c.id]!.completed).length,
    0
  );

  const canClear = canClearChecklistMiss(user);
  const toDTO = (m: Awaited<ReturnType<typeof openMisses>>[number]): MissDTO => ({
    id: m.id,
    branchLabel: m.branchLabel,
    periodLabel: m.periodLabel,
    cadence: m.cadence,
    createdAt: m.createdAt.toISOString(),
    clearedByName: m.clearedByName,
    clearedAt: m.clearedAt ? m.clearedAt.toISOString() : null,
    clearNote: m.clearNote,
  });

  return (
    <>
      <PageHeader
        title="Checklist oversight"
        subtitle="Weekly manager sign-offs across every branch, and any missed-checklist infractions"
      />

      {/* Missed-checklist penalty — reported to leadership; clearable only by CEO/HR. */}
      <div className="mb-5">
        <ChecklistMisses open={open.map(toDTO)} cleared={cleared.map(toDTO)} canClear={canClear} />
        {!canClear ? (
          <p className="mt-2 text-xs text-muted">
            Missed checklists can be cleared only by the CEO or HR director.
          </p>
        ) : null}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="text-sm font-medium text-ink">Current period</div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${outstanding === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {outstanding === 0 ? "All signed" : `${outstanding} outstanding`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-line">
                <th className="px-4 py-2.5 font-semibold">Branch</th>
                {columns.map((c) => (
                  <th key={c.id} className="px-4 py-2.5 font-semibold">
                    {c.cadence === "weekly" ? "Weekly" : c.title} · {c.periodLabel}
                  </th>
                ))}
                <th className="px-4 py-2.5 font-semibold">Missed (open/total)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.branch}>
                  <td className="px-4 py-3 font-medium text-ink">{r.branchLabel}</td>
                  {columns.map((c) => (
                    <td key={c.id} className="px-4 py-3"><Cell s={r.statuses[c.id]} /></td>
                  ))}
                  <td className="px-4 py-3 tabular-nums">
                    <span className={counts[r.branch]?.open ? "text-red-600 font-medium" : "text-muted"}>
                      {counts[r.branch]?.open ?? 0}
                    </span>
                    <span className="text-muted"> / {counts[r.branch]?.total ?? 0}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Cell({ s }: { s: ChecklistStatus | null }) {
  if (!s) return <span className="text-muted">—</span>;
  if (s.completed && s.completion) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-[11px]">✓</span>
        <span className="text-ink">
          {s.completion.signedName}
          <span className="text-muted"> · {DATE(s.completion.createdAt)}</span>
        </span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-2 ${s.overdue ? "text-red-600" : "text-amber-600"}`}>
      <span className={`h-2 w-2 rounded-full ${s.overdue ? "bg-red-500" : "bg-amber-500"}`} />
      {s.overdue ? "Outstanding (overdue)" : "Outstanding"}
    </span>
  );
}
