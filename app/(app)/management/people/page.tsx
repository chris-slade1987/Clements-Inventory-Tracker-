import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { employeeRoster } from "@/lib/people";

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
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const locked = branchLocked(user);
  const roster = await employeeRoster(branch ?? undefined);

  return (
    <>
      <PageHeader title="People / HR" subtitle="Personnel profiles — inspection & review history by branch" />

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
