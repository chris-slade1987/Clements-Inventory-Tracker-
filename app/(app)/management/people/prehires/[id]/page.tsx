import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/inspection";
import { dateShort } from "@/lib/format";
import {
  PACKET_STEPS,
  statusLabel,
  branchName,
  formRows,
  type Responses,
} from "@/lib/prehire";
import PreHireActions from "./PreHireActions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  invited: "bg-slate-100 text-slate-600",
  in_progress: "bg-amber-100 text-amber-700",
  submitted: "bg-brand-100 text-brand-700",
  approved: "bg-emerald-100 text-emerald-700",
  hired: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

export default async function PreHireDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "manager") redirect(homePath(user));

  const { id } = await params;
  const pre = await prisma.preHire.findUnique({ where: { id } });
  if (!pre) notFound();

  const responses = parseJson<Responses>(pre.responses, {});
  const path = `/onboarding/${pre.token}`;
  const canReview = pre.status === "submitted";
  const done = pre.status === "hired" || pre.status === "rejected";

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people/prehires" className="text-xs font-medium text-brand-300 hover:underline">← Pre-hires</Link>
      </div>
      <PageHeader
        title={pre.name}
        subtitle={[pre.position, branchName(pre.branch)].filter((x) => x && x !== "—").join(" · ") || "Candidate"}
        actions={
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[pre.status] ?? "bg-slate-100 text-slate-600"}`}>
            {statusLabel(pre.status)}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        <Card className="p-4">
          <div className="text-sm font-medium text-ink mb-2">Candidate</div>
          <dl className="grid grid-cols-3 gap-y-1.5 text-sm">
            <Row label="Email" value={pre.email} />
            <Row label="Phone" value={pre.phone ?? "—"} />
            <Row label="Position" value={pre.position ?? "—"} />
            <Row label="Branch" value={branchName(pre.branch)} />
            <Row label="Target start" value={pre.targetStart ? dateShort(pre.targetStart) : "—"} />
            <Row label="Invited" value={`${dateShort(pre.invitedAt)}${pre.createdByName ? ` by ${pre.createdByName}` : ""}`} />
            {pre.submittedAt ? <Row label="Submitted" value={dateShort(pre.submittedAt)} /> : null}
            {pre.approvedAt ? <Row label="Reviewed" value={`${dateShort(pre.approvedAt)}${pre.reviewedByName ? ` by ${pre.reviewedByName}` : ""}`} /> : null}
          </dl>
        </Card>

        <Card className="p-4">
          <div className="text-sm font-medium text-ink mb-2">Progress</div>
          <div className="text-sm text-muted mb-3">
            {pre.status === "hired"
              ? "Completed and converted to an employee."
              : pre.status === "rejected"
              ? "This pre-hire was rejected."
              : `${Math.min(pre.currentStep, PACKET_STEPS.length)} of ${PACKET_STEPS.length} steps done.`}
          </div>
          <ol className="space-y-1.5">
            {PACKET_STEPS.map((step, i) => {
              const complete = pre.currentStep > i || done;
              return (
                <li key={step.key} className="flex items-center gap-2 text-sm">
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${complete ? "bg-emerald-100 text-emerald-700" : "bg-black/5 text-muted"}`}>
                    {complete ? "✓" : i + 1}
                  </span>
                  <span className={complete ? "text-ink" : "text-muted"}>{step.title}</span>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>

      <PreHireActions
        id={pre.id}
        path={path}
        employeeId={pre.employeeId}
        canReview={canReview}
        showLink={!done}
      />

      {/* Read-only responses */}
      <div className="mt-5 space-y-4">
        {PACKET_STEPS.map((step) => {
          const resp = responses[step.key];
          const answered = !!resp;
          return (
            <Card key={step.key} className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                <div className="text-sm font-medium text-ink">{step.title}</div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${answered ? "bg-emerald-100 text-emerald-700" : "bg-black/5 text-muted"}`}>
                  {answered ? "Completed" : "Not started"}
                </span>
              </div>
              <div className="p-4 text-sm">
                {!answered ? (
                  <p className="text-muted">The candidate hasn&rsquo;t completed this step yet.</p>
                ) : step.kind === "form" ? (
                  <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {formRows(step, resp).map((r) => (
                      <div key={r.label} className="flex flex-col">
                        <dt className="text-xs text-muted">{r.label}</dt>
                        <dd className="text-ink">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <div className="space-y-2">
                    {step.kind === "acknowledgment" && step.documents ? (
                      <ul className="space-y-1">
                        {step.documents.map((d) => (
                          <li key={d.key} className="flex items-center gap-2 text-ink">
                            <span className="text-emerald-600">{resp.acknowledged?.[d.key] ? "✓" : "—"}</span>
                            {d.label}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {resp.signature?.signedName ? (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-800">
                        Signed by <span className="font-medium">{resp.signature.signedName}</span> on {dateShort(resp.signature.signedAt)}
                      </div>
                    ) : (
                      <p className="text-muted">Not yet signed.</p>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {pre.employeeId ? (
        <div className="mt-5">
          <Link href={`/management/people/${pre.employeeId}`} className="text-sm font-medium text-brand-700 hover:underline">
            View employee profile →
          </Link>
        </div>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="col-span-1 text-xs text-muted self-center">{label}</dt>
      <dd className="col-span-2 text-ink">{value}</dd>
    </>
  );
}
