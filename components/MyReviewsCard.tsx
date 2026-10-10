import Link from "next/link";
import { Card } from "@/components/ui";
import { reviewsForReviewer, REVIEW_LABEL } from "@/lib/review";

// "New-hire reviews to complete" — the reviews THIS user was assigned to conduct.
// Rendered on every landing page so whoever is named reviewer sees it, regardless
// of where their role sends them home (admins land on /dashboard, the field-ops
// and sales directors on their own hubs — none of which showed this before, so an
// assigned reviewer there got no on-screen notice). Returns null when there's
// nothing to do, so it only appears when it matters.
export default async function MyReviewsCard({ userId }: { userId: string }) {
  const myReviews = await reviewsForReviewer(userId);
  if (myReviews.length === 0) return null;
  const nowMs = new Date().getTime();

  return (
    <Card className="p-0 overflow-hidden mb-5 ring-1 ring-amber-200">
      <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">
        New-hire reviews to complete · {myReviews.length}
      </div>
      <ul className="divide-y divide-line">
        {myReviews.map((r) => (
          <li key={r.id}>
            <Link href={`/reviews/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.dueDate.getTime() < nowMs ? "bg-red-500" : "bg-amber-500"}`} />
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
  );
}
