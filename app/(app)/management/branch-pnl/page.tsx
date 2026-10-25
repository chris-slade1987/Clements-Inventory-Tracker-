import { redirect } from "next/navigation";

// Branch P&L is the branch view of the Executive (financials) dashboard. This
// route redirects there so old links (and bookmarks) keep working.
export default async function BranchPnlRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const branch = sp.branch;
  // Branch P&L is the Branches tab of the consolidated Executive dashboard.
  redirect(branch ? `/executive?tab=branches&scope=${encodeURIComponent(branch)}` : "/executive?tab=branches");
}
