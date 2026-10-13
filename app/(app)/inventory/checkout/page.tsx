import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The scan-to-issue checkout was consolidated into the single Check-Out screen.
// This route now permanently redirects to /check-out so old bookmarks and nav
// links keep working. The branch query (?branch=) is preserved for admins.
export default async function LegacyScanCheckoutRedirect({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const sp = await searchParams;
  const branch = (sp.branch ?? "").trim();
  redirect(branch ? `/check-out?branch=${encodeURIComponent(branch)}` : "/check-out");
}
