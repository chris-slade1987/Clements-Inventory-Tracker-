import { redirect } from "next/navigation";

// Branch P&L is now consolidated into the branch view of the Management
// dashboard. This route redirects to the equivalent branch scope so old links
// (and bookmarks) keep working.
export default async function BranchPnlRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const branch = sp.branch;
  redirect(branch ? `/management?scope=${encodeURIComponent(branch)}` : "/management");
}
