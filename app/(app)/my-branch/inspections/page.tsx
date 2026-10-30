import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { inspectionStatus, technicianGrades, gradeLetter, vehicleCoverageGaps } from "@/lib/inspection";

export const dynamic = "force-dynamic";

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function gradeChip(grade: string) {
  const c = grade === "A" || grade === "B" ? "bg-emerald-100 text-emerald-700" : grade === "C" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return `inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${c}`;
}

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const locked = branchLocked(user);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [insp, grades, coverageGaps] = await Promise.all([
    inspectionStatus(year, month, branch ?? undefined),
    technicianGrades(branch ?? undefined),
    vehicleCoverageGaps(branch ?? undefined),
  ]);

  return (
    <>
      <PageHeader title="Vehicle Inspections" subtitle={`${MONTHS[month]} ${year} — ${insp.completed}/${insp.total} complete`} />

      {locked ? null : (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <BranchPill href="/my-branch/inspections" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <BranchPill key={b.key} href={`/my-branch/inspections?branch=${b.key}`} label={b.label} active={branch === b.key} />
          ))}
        </div>
      )}

      {/* This month's inspection status */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">This month · by vehicle</div>
        {insp.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No active vehicles.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Technician</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {insp.rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">{r.unitNumber ? `#${r.unitNumber} · ` : ""}{r.name}</td>
                    <td className="px-3 py-2 text-muted">{r.branch ? branchLabel(r.branch) : "—"}</td>
                    <td className="px-3 py-2 text-muted">{r.assignedTo ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.inspection ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={gradeChip(r.inspection.grade)}>{r.inspection.grade}</span>
                          <span className="text-xs text-muted tabular-nums">{r.inspection.scorePct}%</span>
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/fleet/${r.id}/inspect?${r.inspection ? "view=report&" : ""}src=branch${requested ? `&branch=${requested}` : ""}`} className="text-xs font-medium text-brand-700 hover:underline">
                        {r.inspection ? "View report" : "Start inspection"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Coverage gaps — techs / advisors with no vehicle linked (fix these) */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">
          Needs a vehicle linked · technicians &amp; service advisors
          {coverageGaps.length > 0 ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{coverageGaps.length}</span> : null}
        </div>
        {coverageGaps.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Every active technician and service advisor has a vehicle linked.</p>
        ) : (
          <>
            <p className="px-4 pt-3 text-xs text-muted">These people have no vehicle assigned, so nothing shows for them on inspections. Link a truck on <Link href="/fleet/assignments" className="text-brand-700 hover:underline">Fleet → Driver assignments</Link>.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Branch</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageGaps.map((g) => (
                    <tr key={g.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">{g.name}</td>
                      <td className="px-3 py-2 text-muted">{g.role ?? "—"}</td>
                      <td className="px-4 py-2 text-muted">{g.branch ? branchLabel(g.branch) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Technician grades (rolling) */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Technician grades · rolling average</div>
        {grades.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No inspections recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Technician</th>
                  <th className="px-3 py-2 font-medium text-right">Inspections</th>
                  <th className="px-3 py-2 font-medium text-right">Avg score</th>
                  <th className="px-4 py-2 font-medium text-center">Grade</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g.technicianName} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">{g.technicianName}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{g.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{g.avgPct}%</td>
                    <td className="px-4 py-2 text-center"><span className={gradeChip(gradeLetter(g.avgPct))}>{g.grade}</span></td>
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

function BranchPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-white shadow" : "text-muted hover:text-ink"}`}>
      {label}
    </Link>
  );
}
