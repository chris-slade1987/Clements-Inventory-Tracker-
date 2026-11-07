import { redirect } from "next/navigation";

// The Quarterly Sales Director Review moved into Scorecards (the super-admin
// review hub). Kept as a redirect so earlier emails, Inbox reminders and
// bookmarks still land on the review, with the same quarter selected.
export default async function SalesQuarterlyReviewRedirect({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.year) q.set("year", sp.year);
  if (sp.quarter) q.set("quarter", sp.quarter);
  const qs = q.toString();
  redirect(`/management/scorecards/sales-director${qs ? `?${qs}` : ""}`);
}
