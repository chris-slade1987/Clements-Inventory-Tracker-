import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader, Card } from "@/components/ui";
import PrintButton from "@/components/PrintButton";
import { requireUser, homePath } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";
import { REVIEW_LABEL, STATUS_LABEL, parseResponses, reviewById, getReviewForm, templateForEmployee } from "@/lib/review";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import ReviewForm from "./ReviewForm";
import TemplateSelect from "./TemplateSelect";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const review = await reviewById(id);
  if (!review) notFound();

  const hr = isHrDirector(user);
  const canManageTemplate = hr || !!user.hrAccess; // admin/HR director OR HR-flag holders
  const isReviewer = !!review.reviewerUserId && review.reviewerUserId === user.id;
  const isSubjectEmployee = !!user.employeeId && user.employeeId === review.employeeId;
  if (!hr && !isReviewer && !isSubjectEmployee) redirect(homePath(user));

  const resolvedTemplate = review.template ?? templateForEmployee(review.employee) ?? "technician";
  const form = getReviewForm(resolvedTemplate, review.type);
  const responses = parseResponses(review.responses);
  const completed = review.status === "completed";
  const label = REVIEW_LABEL[review.type] ?? "Review";

  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <Link href={hr ? "/management/people/reviews" : isSubjectEmployee ? "/me" : "/my-branch"} className="text-xs font-medium text-brand-700 hover:underline">← Back</Link>
        <PrintButton />
      </div>
      <PageHeader
        title={`${review.employee.name} — ${label}`}
        subtitle={[review.employee.role, review.branch ? branchLabel(review.branch) : null, `due ${dateShort(review.dueDate)}`].filter(Boolean).join(" · ")}
      />

      <Card className="p-4 mb-4 flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${completed ? "bg-emerald-100 text-emerald-700" : review.status === "pending_approval" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
          {STATUS_LABEL[review.status] ?? review.status}
        </span>
        {review.reviewerName ? <span className="text-xs text-muted">Reviewer: <span className="text-ink font-medium">{review.reviewerName}</span></span> : null}
        <span className="text-xs text-muted">Start date: {dateShort(review.startDate)}</span>
        {isSubjectEmployee && !completed ? <span className="text-xs text-muted">Review this with your manager, then sign below.</span> : null}
        {canManageTemplate ? (
          <TemplateSelect reviewId={review.id} current={resolvedTemplate} disabled={completed} />
        ) : null}
      </Card>

      <ReviewForm
        reviewId={review.id}
        form={form}
        initialResponses={responses}
        employeeName={review.employee.name}
        reviewerName={review.reviewerName}
        status={review.status}
        sig={{
          reviewerSignedName: review.reviewerSignedName,
          reviewerSignedAt: iso(review.reviewerSignedAt),
          employeeSignedName: review.employeeSignedName,
          employeeSignedAt: iso(review.employeeSignedAt),
          hrSignedName: review.hrSignedName,
          hrSignedAt: iso(review.hrSignedAt),
        }}
        canEdit={(isReviewer || hr) && !completed}
        canSignReviewer={(isReviewer || hr) && !review.reviewerSignedAt && !completed}
        canSignEmployee={(isSubjectEmployee || hr) && !review.employeeSignedAt && !completed}
        canApproveHr={hr && !review.hrSignedAt && !completed}
        canReset={hr}
      />
    </>
  );
}
