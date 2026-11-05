import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { OverviewPanel } from "@/app/(app)/executive/panels/OverviewPanel";
import MyBranchViewToggle from "@/app/(app)/my-branch/MyBranchViewToggle";

export const dynamic = "force-dynamic";

// Company KPIs, INSIDE the Company section. Mounts the same budget-vs-actual KPI
// board the Executive center uses (OverviewPanel) but under /my-branch/kpis, so the
// To-dos ⇄ KPIs ⇄ Routes ⇄ Command toggle never bounces the user out to Executive.
// Branch-locked managers see their own branch; super admins / exec see company-wide
// with a branch toggle and a month/basis picker — the KPIs they check daily. The
// quarterly scorecard is a separate thing, reached from its own tile, not here.
export default async function MyBranchKpisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const branchQuery = sp.branch ? `?branch=${sp.branch}` : "";
  return (
    <>
      <div className="mb-2">
        <Link href="/my-branch" className="text-xs font-medium text-brand-700 hover:underline">← My Branch</Link>
      </div>
      <MyBranchViewToggle view="kpis" branchQuery={branchQuery} />
      <OverviewPanel user={user} sp={sp} basePath="/my-branch/kpis" />
    </>
  );
}
