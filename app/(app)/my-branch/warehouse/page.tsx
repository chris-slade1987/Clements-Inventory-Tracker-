import Link from "next/link";
import { Card, PageHeader, btn } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import { warehouseStatus, warehouseHistory } from "@/lib/warehouse";

export const dynamic = "force-dynamic";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function gradeChip(g: string) {
  const c = g === "A" || g === "B" ? "bg-emerald-100 text-emerald-700" : g === "C" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return `inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${c}`;
}

export default async function WarehousePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const locked = branchLocked(user);
  const canInspect = user.role === "admin" || user.role === "manager";

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const effBranch = branch ?? BRANCHES[0].key;
  const status = await warehouseStatus(year, month, effBranch);
  const history = await warehouseHistory(branch ?? undefined);

  return (
    <>
      <PageHeader title="Warehouse Safety Inspection" subtitle={`${branchLabel(effBranch)} · monthly · FL Statute 482 / FDACS + OSHA`} />

      {!locked ? (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          {BRANCHES.map((b) => (
            <Link key={b.key} href={`/my-branch/warehouse?branch=${b.key}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${effBranch === b.key ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>{b.label}</Link>
          ))}
        </div>
      ) : null}

      <Card className="p-4 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-ink">
            {MONTH_ABBR[month]} {year} inspection
            {status.done ? (
              <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700">Complete · {status.inspection!.scorePct}%</span>
            ) : (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600">Not done this month</span>
            )}
          </div>
          <div className="text-xs text-muted mt-0.5">Complete monthly to satisfy the warehouse-inspection scorecard item.</div>
        </div>
        {canInspect ? (
          <Link href={`/my-branch/warehouse/inspect?branch=${effBranch}&year=${year}&month=${month}`} className={btn.primary}>
            {status.done ? "View / edit" : "Start inspection"}
          </Link>
        ) : null}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">History</div>
        {history.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No warehouse inspections recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Inspector</th>
                  <th className="px-3 py-2 font-medium text-right">Score</th>
                  <th className="px-4 py-2 font-medium text-center">Grade</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link href={`/my-branch/warehouse/inspect?branch=${h.branch}&year=${h.year}&month=${h.month}`} className="text-brand-700 hover:underline">{MONTH_ABBR[h.month]} {h.year}</Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{branchLabel(h.branch)}</td>
                    <td className="px-3 py-2 text-muted">{dateShort(h.date)}</td>
                    <td className="px-3 py-2 text-muted">{h.inspectorName ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.score}/{h.maxScore} · {h.scorePct}%</td>
                    <td className="px-4 py-2 text-center"><span className={gradeChip(h.grade)}>{h.grade}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
