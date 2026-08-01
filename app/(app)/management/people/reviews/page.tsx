import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";
import { allReviews, reviewerCandidates, REVIEW_LABEL, STATUS_LABEL } from "@/lib/review";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import AssignReviewer from "./AssignReviewer";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  due: "bg-red-100 text-red-700",
  sent: "bg-amber-100 text-amber-700",
  in_progress: "bg-amber-100 text-amber-700",
  pending_approval: "bg-brand-100 text-brand-700",
  completed: "bg-emerald-100 text-emerald-700",
};

export default async function ReviewsPage() {
  const user = await requireUser();
  if (!isHrDirector(user)) redirect(homePath(user));

  const [reviews, candidates] = await Promise.all([allReviews(), reviewerCandidates()]);
  const now = Date.now();

  const active = reviews.filter((r) => r.status !== "completed");
  const completed = reviews.filter((r) => r.status === "completed");

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people" className="text-xs font-medium text-brand-700 hover:underline">← People / HR</Link>
      </div>
      <PageHeader title="New-hire reviews" subtitle="30 & 60-day reviews — assign a reviewer, track signatures, give final approval" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Tile label="Awaiting assignment" value={String(reviews.filter((r) => r.status === "due").length)} tone="bad" />
        <Tile label="In progress" value={String(reviews.filter((r) => r.status === "sent" || r.status === "in_progress").length)} tone="warn" />
        <Tile label="Pending your approval" value={String(reviews.filter((r) => r.status === "pending_approval").length)} tone="warn" />
        <Tile label="Completed" value={String(completed.length)} tone="good" />
      </div>

      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Active reviews</div>
        {active.length === 0 ? (
          <EmptyState title="Nothing outstanding" hint="New-hire reviews appear here automatically as employees reach their 30 and 60-day marks." />
        ) : (
          <ul className="divide-y divide-line">
            {active.map((r) => {
              const overdue = r.dueDate.getTime() < now;
              const both = r.reviewerSignedAt && r.employeeSignedAt;
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                    <Link href={`/management/people/${r.employeeId}`} className="text-sm font-medium text-brand-700 hover:underline">{r.employee.name}</Link>
                    <span className="text-xs text-muted">{REVIEW_LABEL[r.type]}{r.branch ? ` · ${branchLabel(r.branch)}` : ""}</span>
                    <span className={`text-xs ${overdue ? "text-red-600 font-medium" : "text-muted"}`}>{overdue ? "overdue" : "due"} {dateShort(r.dueDate)}</span>
                    <Link href={`/reviews/${r.id}`} className="ml-auto text-xs font-medium text-brand-700 hover:underline">Open →</Link>
                  </div>

                  {r.status === "due" || r.status === "sent" ? (
                    <div className="mt-2">
                      <AssignReviewer reviewId={r.id} branch={r.branch} candidates={candidates} currentReviewerId={r.reviewerUserId} />
                    </div>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted">
                      <span>Reviewer: {r.reviewerName ?? "—"} {r.reviewerSignedAt ? "✅" : "⏳"}</span>
                      <span>Employee {r.employeeSignedAt ? "✅" : "⏳"}</span>
                      {r.status === "pending_approval" ? <span className="text-brand-600 font-medium">Ready for your approval →</span> : both ? null : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {completed.length > 0 ? (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Completed & filed</div>
          <ul className="divide-y divide-line">
            {completed.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <Link href={`/management/people/${r.employeeId}`} className="text-sm font-medium text-brand-700 hover:underline">{r.employee.name}</Link>
                <span className="text-xs text-muted">{REVIEW_LABEL[r.type]}{r.branch ? ` · ${branchLabel(r.branch)}` : ""}</span>
                <span className="text-xs text-muted">approved {r.completedAt ? dateShort(r.completedAt) : "—"}</span>
                <Link href={`/reviews/${r.id}`} className="ml-auto text-xs font-medium text-brand-700 hover:underline">View →</Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
    </Card>
  );
}
