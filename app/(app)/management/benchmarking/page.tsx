import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser, canViewExec } from "@/lib/auth";
import { computeBenchmarks } from "@/lib/benchmarking";
import { branchForecasts, companyBookOutlook } from "@/lib/forecasting";
import BenchmarkingClient from "./BenchmarkingClient";

export const dynamic = "force-dynamic";

// Branch Benchmarking — CanopyOS vision Theme 10. A cross-branch league table on
// the canonical metrics (leader/laggard emphasis via the Signal ramp where it's an
// attainment/pace metric; honest rank emphasis for cost/rate metrics) plus a
// first-slice year-end pacing/forecast panel. Read-only aggregation; same audience
// as the exec financial views (admins / senior leadership / board) — non-exec
// principals are bounced to the operating Company KPIs, mirroring /executive.
export default async function BenchmarkingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!canViewExec(user)) redirect("/management");
  const sp = await searchParams;

  const benchmarks = await computeBenchmarks(sp.p);
  if (!benchmarks) {
    return (
      <>
        <PageHeader title="Branch Benchmarking" subtitle="Cross-branch league table & pacing" />
        <EmptyState
          title="No report data yet"
          hint="Benchmarking populates once a Monthly Board Report (MBR) is uploaded."
        />
        <div className="mt-4">
          <Link href="/executive" className="text-sm font-medium text-brand-700 hover:underline">
            ← Back to Executive — Operating
          </Link>
        </div>
      </>
    );
  }

  const [forecasts, book] = await Promise.all([branchForecasts(benchmarks.year), companyBookOutlook()]);

  return (
    <>
      <PageHeader
        title="Branch Benchmarking"
        subtitle={`Cross-branch league table & year-end pacing · ${benchmarks.periodLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/executive" className="text-sm font-medium text-brand-700 hover:underline">
              Executive — Operating →
            </Link>
            <Link href="/management" className="text-sm font-medium text-brand-700 hover:underline">
              Company KPIs →
            </Link>
          </div>
        }
      />
      <BenchmarkingClient benchmarks={benchmarks} forecasts={forecasts} book={book} />
    </>
  );
}
