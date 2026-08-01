import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAts, excludedCandidates, STAGE_LABELS } from "@/lib/ats";
import { dateShort } from "@/lib/format";
import ReactivateButton from "../jobs/[id]/ReactivateButton";

export const dynamic = "force-dynamic";

export default async function ExcludedArchivePage() {
  const user = await requireUser();
  if (!canManageAts(user)) redirect(homePath(user));

  const excluded = await excludedCandidates();

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people/jobs" className="text-xs font-medium text-brand-700 hover:underline">← Hiring / Jobs</Link>
      </div>
      <PageHeader title="Excluded archive" subtitle="Every excluded candidate across all jobs — retained, reason-tagged, reactivatable" />

      {excluded.length === 0 ? (
        <EmptyState title="No excluded candidates" hint="When you exclude a candidate, they're retained here with the reason and the stage they were cut at." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Candidate</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Cut at</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">By</th>
                  <th className="px-4 py-2 font-medium text-right">Reactivate</th>
                </tr>
              </thead>
              <tbody>
                {excluded.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/management/people/candidates/${c.id}`} className="text-brand-700 hover:underline">{c.name}</Link>
                      {c.keepWarm ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Keep warm</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{c.job?.title ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{c.excludedStage ? STAGE_LABELS[c.excludedStage] ?? c.excludedStage : "—"}</td>
                    <td className="px-3 py-2 text-ink">{c.excludedReason ?? "—"}</td>
                    <td className="px-3 py-2 text-muted whitespace-nowrap">{c.excludedAt ? dateShort(c.excludedAt) : "—"}</td>
                    <td className="px-3 py-2 text-muted">{c.excludedByName ?? "—"}</td>
                    <td className="px-4 py-2 text-right"><ReactivateButton candidateId={c.id} /></td>
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
