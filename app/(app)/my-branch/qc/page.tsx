import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";

export const dynamic = "force-dynamic";

export default async function QcPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const branch = scopedBranch(user, BRANCHES.find((b) => b.key === sp.branch)?.key ?? null);

  return (
    <>
      <PageHeader title="Quality Control Reports" subtitle={`${branch ? branchLabel(branch) : "All branches"} · service quality checks`} />
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-sm font-medium text-ink">Quality control reports</div>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-muted">Coming soon</span>
        </div>
        <p className="text-sm text-muted">
          This will capture the branch&rsquo;s monthly quality-control checks — service redo/callback review,
          documentation spot-checks, and customer-quality follow-ups — recorded per month. Completing it will
          satisfy the <strong className="text-ink">Quality Control Reports</strong> item on your quarterly scorecard.
        </p>
      </Card>
    </>
  );
}
