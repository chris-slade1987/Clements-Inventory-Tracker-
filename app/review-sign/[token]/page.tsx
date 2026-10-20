import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";
import { getReviewForm, templateForEmployee, REVIEW_LABEL, parseResponses } from "@/lib/review";
import ReviewSignClient from "./ReviewSignClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review & sign — CanopyOS" };

const D = (d: Date | null) => (d ? d.toLocaleDateString() : "");

export default async function ReviewSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const review = await prisma.newHireReview.findUnique({
    where: { employeeToken: token },
    include: { employee: { select: { name: true, branch: true, role: true, title: true, user: { select: { accessLevel: true } } } } },
  });

  return (
    <div className="min-h-screen bg-forest-grad px-4 py-10 flex justify-center">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clements-mark.svg" alt="Clements" className="h-12 w-12" />
          <h1 className="mt-3 text-xl font-light tracking-tight text-white">CanopyOS</h1>
        </div>

        {!review ? (
          <Panel><p className="text-sm text-slate-600">This signing link is not valid or has expired. Please contact your manager or HR.</p></Panel>
        ) : review.employeeSignedAt ? (
          <Panel>
            <h2 className="text-lg font-semibold text-slate-900">Already signed</h2>
            <p className="mt-1 text-sm text-slate-600">You e-signed this review on {D(review.employeeSignedAt)}. No further action is needed.</p>
          </Panel>
        ) : (
          (() => {
            const form = getReviewForm(review.template ?? templateForEmployee(review.employee) ?? "technician", review.type);
            const label = REVIEW_LABEL[review.type] ?? "Review";
            const responses = parseResponses(review.responses);
            return (
              <Panel>
                <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{review.employee.name}</h2>
                <p className="text-sm text-slate-500">
                  {review.employee.branch ? branchLabel(review.employee.branch) : ""}
                  {review.reviewerName ? ` · reviewer ${review.reviewerName}` : ""} · due {D(review.dueDate)}
                </p>

                {(() => {
                  // Read-only context: what the reviewer recorded (manager-owned
                  // items). The reviewee's OWN questions are editable below in the
                  // client so they can complete them before signing.
                  const reviewerRows = form.sections
                    .map((section) => ({
                      title: section.title,
                      rows: section.items.filter((it) => it.who !== "employee" && (responses[it.key] ?? "").trim()),
                    }))
                    .filter((s) => s.rows.length > 0);
                  if (reviewerRows.length === 0) return null;
                  return (
                    <div className="mt-4 space-y-3 max-h-[32vh] overflow-y-auto pr-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">What your reviewer recorded</div>
                      {reviewerRows.map((section) => (
                        <div key={section.title}>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{section.title}</div>
                          <dl className="mt-1 space-y-1">
                            {section.rows.map((it) => (
                              <div key={it.key} className="text-sm">
                                <dt className="text-slate-500">{it.label}</dt>
                                <dd className="text-slate-800 whitespace-pre-line">{responses[it.key]}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <ReviewSignClient token={token} defaultName={review.employee.name} form={form} initialResponses={responses} />
              </Panel>
            );
          })()
        )}
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/95 p-5 shadow-xl">{children}</div>;
}
