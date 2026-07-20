import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { rollup, type ChecklistStatus } from "@/lib/checklists";

export const dynamic = "force-dynamic";

const DATE = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function ChecklistOversightPage() {
  const user = await requireUser();
  // Leadership rollup — admins + senior leadership only.
  if (user.role !== "admin" && !user.seniorLeadership) redirect("/my-branch");

  const { weeklyLabel, monthlyLabel, rows } = await rollup(new Date());

  const outstanding = rows.reduce(
    (n, r) => n + (r.weekly && !r.weekly.completed ? 1 : 0) + (r.monthly && !r.monthly.completed ? 1 : 0),
    0
  );

  return (
    <>
      <PageHeader
        title="Checklist oversight"
        subtitle="Weekly &amp; monthly manager sign-offs across every branch"
      />

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
                <th className="px-4 py-2.5 font-semibold">Weekly · {weeklyLabel}</th>
                <th className="px-4 py-2.5 font-semibold">Monthly · {monthlyLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.branch}>
                  <td className="px-4 py-3 font-medium text-ink">{r.branchLabel}</td>
                  <td className="px-4 py-3"><Cell s={r.weekly} /></td>
                  <td className="px-4 py-3"><Cell s={r.monthly} /></td>
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
