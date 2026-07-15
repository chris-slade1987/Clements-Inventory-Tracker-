import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";
import { formerEmployees, separationTypeLabel, reasonCategoryLabel, EXIT_STATUS_LABEL } from "@/lib/separation";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

const EXIT_STYLE: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  bypassed: "bg-slate-100 text-slate-600",
  pending: "bg-amber-100 text-amber-700",
};

export default async function FormerEmployeesPage() {
  const user = await requireUser();
  if (!isHrDirector(user)) redirect(homePath(user));
  const former = await formerEmployees();

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people" className="text-xs font-medium text-brand-300 hover:underline">← People / HR</Link>
      </div>
      <PageHeader title="Former employees" subtitle="Separation records & exit interviews — profiles and all linked data are retained" />

      {former.length === 0 ? (
        <EmptyState title="No former employees" hint="Terminated or departed employees appear here. Offboard someone from their profile." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Last day</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Rehire</th>
                  <th className="px-4 py-2 font-medium text-center">Exit interview</th>
                </tr>
              </thead>
              <tbody>
                {former.map((e) => {
                  const sep = e.separation;
                  const exit = sep?.exitStatus ?? "pending";
                  return (
                    <tr key={e.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/management/people/${e.id}`} className="text-brand-700 hover:underline">{e.name}</Link>
                        <div className="text-[11px] text-muted">{e.role ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-muted">{e.branch ? branchLabel(e.branch) : "—"}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{sep?.lastDay ? dateShort(sep.lastDay) : e.terminatedAt ? dateShort(e.terminatedAt) : "—"}</td>
                      <td className="px-3 py-2 text-muted">{separationTypeLabel(sep?.separationType ?? null)}</td>
                      <td className="px-3 py-2 text-muted">{reasonCategoryLabel(sep?.reasonCategory ?? null)}</td>
                      <td className="px-3 py-2 text-muted">{sep?.rehireEligible == null ? "—" : sep.rehireEligible ? "Eligible" : "Not eligible"}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${EXIT_STYLE[exit]}`}>{EXIT_STATUS_LABEL[exit]}</span>
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
