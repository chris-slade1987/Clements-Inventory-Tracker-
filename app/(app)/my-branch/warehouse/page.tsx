import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";

export const dynamic = "force-dynamic";

export default async function WarehousePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const branch = scopedBranch(user, BRANCHES.find((b) => b.key === sp.branch)?.key ?? null);

  return (
    <>
      <PageHeader title="Warehouse Inspection" subtitle={`${branch ? branchLabel(branch) : "All branches"} · monthly warehouse & storage inspection`} />
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-sm font-medium text-ink">Monthly warehouse inspection</div>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-muted">Coming soon</span>
        </div>
        <p className="text-sm text-muted">
          This will be a fillable, tablet-friendly form — the same pattern as the vehicle inspection — covering
          chemical storage &amp; labeling, organization, safety equipment (extinguishers, first aid, spill kits),
          cleanliness, and licenses/postings. Completing it each month will satisfy the
          <strong className="text-ink"> Warehouse Inspection Reports</strong> item on your quarterly scorecard.
        </p>
      </Card>
    </>
  );
}
