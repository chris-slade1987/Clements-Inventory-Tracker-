import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { employeeAssignments, STATUS_LABEL } from "@/lib/training";
import { openReviewsForEmployee, reviewsForReviewer, REVIEW_LABEL } from "@/lib/review";

export const dynamic = "force-dynamic";

export default async function MyWorkPage() {
  const user = await requireUser();
  if (!user.employeeId) {
    return (
      <>
        <PageHeader title="My Work" subtitle="Your assignments & training" />
        <EmptyState title="No personnel profile linked" hint="This login isn't linked to an employee profile, so there's no assigned training to show." />
      </>
    );
  }

  const [assignments, reviews, conducting] = await Promise.all([
    employeeAssignments(user.employeeId),
    openReviewsForEmployee(user.employeeId),
    reviewsForReviewer(user.id),
  ]);
  const open = assignments.filter((a) => a.status !== "completed");
  const completed = assignments.filter((a) => a.status === "completed");
  const reviewsToSign = reviews.filter((r) => !r.employeeSignedAt);
  const now = Date.now();

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} subtitle="Your open items & training" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 mb-5">
        <Tile label="Open training" value={String(open.length)} tone={open.length ? "warn" : "good"} sub={open.length ? "Action needed" : "All caught up"} />
        <Tile label="Completed" value={String(completed.length)} tone="good" />
        <Tile label="Assigned total" value={String(assignments.length)} />
      </div>

      {reviewsToSign.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5 ring-1 ring-amber-200">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Your new-hire review{reviewsToSign.length === 1 ? "" : "s"}</div>
          <ul className="divide-y divide-line">
            {reviewsToSign.map((r) => (
              <li key={r.id}>
                <Link href={`/reviews/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{REVIEW_LABEL[r.type]}</span>
                    <span className="block text-xs text-muted">Review this with your manager, then add your signature · due {r.dueDate.toLocaleDateString()}</span>
                  </span>
                  <span className="text-xs font-medium text-brand-700 mt-0.5">Open &amp; sign →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {conducting.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5 ring-1 ring-amber-200">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">New-hire review{conducting.length === 1 ? "" : "s"} to conduct</div>
          <ul className="divide-y divide-line">
            {conducting.map((r) => (
              <li key={r.id}>
                <Link href={`/reviews/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.dueDate.getTime() < now ? "bg-red-500" : "bg-amber-500"}`} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{r.employee.name} — {REVIEW_LABEL[r.type]}</span>
                    <span className="block text-xs text-muted">
                      {r.status === "pending_approval" ? "Signed — awaiting HR approval" : r.reviewerSignedAt ? "You signed — awaiting employee" : "Complete & sign with the employee"}
                      {` · due ${r.dueDate.toLocaleDateString()}`}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-brand-700 mt-0.5">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="text-sm font-medium text-ink">Open items</div>
          <Link href="/me/library" className="text-xs font-medium text-brand-300 hover:underline">Lesson library →</Link>
        </div>
        {open.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nothing outstanding — you&rsquo;re all caught up. 🎉</p>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((a) => {
              const overdue = a.dueDate && a.dueDate.getTime() < now;
              return (
                <li key={a.id}>
                  <Link href={`/me/training/${a.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${overdue ? "bg-red-500" : "bg-amber-500"}`} />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-ink">{a.course.title}</span>
                      <span className="block text-xs text-muted">
                        {STATUS_LABEL[a.status]}
                        {a.dueDate ? ` · ${overdue ? "overdue" : "due"} ${a.dueDate.toLocaleDateString()}` : ""}
                        {a.course.category === "onboarding" ? " · onboarding" : ""}
                      </span>
                    </span>
                    <span className="text-xs font-medium text-brand-700 mt-0.5">{a.status === "not_started" ? "Start →" : "Resume →"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {completed.length > 0 ? (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Completed</div>
          <ul className="divide-y divide-line">
            {completed.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 text-sm text-ink">{a.course.title}</span>
                <span className="text-xs text-muted tabular-nums">{a.score}%</span>
                <Link href={`/me/training/${a.id}`} className="text-xs font-medium text-brand-700 hover:underline">Review</Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
      {sub ? <div className="text-xs text-muted mt-0.5">{sub}</div> : null}
    </Card>
  );
}
