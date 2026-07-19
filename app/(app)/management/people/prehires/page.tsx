import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { listPreHires, statusLabel, branchName, canManagePreHire } from "@/lib/prehire";
import { dateShort } from "@/lib/format";
import NewPreHire from "./NewPreHire";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  invited: "bg-slate-100 text-slate-600",
  in_progress: "bg-amber-100 text-amber-700",
  submitted: "bg-brand-100 text-brand-700",
  approved: "bg-emerald-100 text-emerald-700",
  hired: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

export default async function PreHiresPage() {
  const user = await requireUser();
  if (!canManagePreHire(user)) redirect(homePath(user));

  const prehires = await listPreHires();
  const needsReview = prehires.filter((p) => p.status === "submitted").length;

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people" className="text-xs font-medium text-brand-300 hover:underline">← People / HR</Link>
      </div>
      <PageHeader
        title="Pre-hires / onboarding"
        subtitle="Invite a candidate, they complete onboarding online, then approve to convert into an employee"
        actions={<NewPreHire />}
      />

      {needsReview > 0 ? (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-800">
          {needsReview} candidate{needsReview === 1 ? "" : "s"} submitted and waiting for review.
        </div>
      ) : null}

      {prehires.length === 0 ? (
        <EmptyState
          title="No pre-hires yet"
          hint="Start by inviting a candidate — they'll get a magic link to complete onboarding with no login."
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Candidate</th>
                  <th className="px-3 py-2 font-medium">Position</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Invited</th>
                  <th className="px-3 py-2 font-medium">Progress</th>
                  <th className="px-4 py-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {prehires.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/management/people/prehires/${p.id}`} className="text-brand-700 hover:underline">{p.name}</Link>
                      <div className="text-xs text-muted">{p.email}</div>
                    </td>
                    <td className="px-3 py-2 text-muted">{p.position ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{branchName(p.branch)}</td>
                    <td className="px-3 py-2 text-muted whitespace-nowrap">{dateShort(p.invitedAt)}</td>
                    <td className="px-3 py-2 text-muted tabular-nums">
                      {p.status === "hired" ? "Converted" : `Step ${Math.min(p.currentStep, 4)} / 4`}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[p.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {statusLabel(p.status)}
                      </span>
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
