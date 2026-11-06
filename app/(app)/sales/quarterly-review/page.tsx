import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import PrintButton from "@/components/PrintButton";
import { requireUser, canManageSales } from "@/lib/auth";
import { money } from "@/lib/format";
import { SALES_REVIEW_METRICS, SALES_REVIEW_SECTIONS, salesReviewSnapshot } from "@/lib/sales-review";
import SalesReviewForm from "./SalesReviewForm";

export const dynamic = "force-dynamic";

// Quarterly Sales Director Review — housed in the Sales section. Reviewer = COO;
// subject = the Sales Director; scored on the sales TEAM'S quarterly performance +
// leadership. Pre-fills a live team snapshot, then the reviewer fills Met-Not +
// notes + narrative and prints/saves to PDF. See lib/sales-review.ts.
export default async function SalesQuarterlyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const user = await requireUser();
  // The Sales Director (to see their own review) and admins / super admins (to
  // conduct it) — same gate as the rest of the Sales Team management area.
  if (!canManageSales(user)) redirect("/me");

  const sp = await searchParams;
  const now = new Date();
  const curYear = now.getFullYear();
  const curQuarter = Math.floor(now.getMonth() / 3) + 1;
  const year = Number(sp.year) || curYear;
  const quarter = [1, 2, 3, 4].includes(Number(sp.quarter)) ? Number(sp.quarter) : curQuarter;

  const snap = await salesReviewSnapshot(year, quarter);

  // Year options: this year and the two prior.
  const years = [curYear, curYear - 1, curYear - 2];

  const attainmentPct = snap.teamTarget > 0 && snap.closedYtd != null ? Math.round((snap.closedYtd / snap.teamTarget) * 100) : null;

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <Link href="/sales" className="text-xs font-medium text-brand-700 hover:underline">← Sales Team</Link>
        <PrintButton />
      </div>

      <PageHeader
        title="Quarterly Sales Director Review"
        subtitle={`${snap.periodLabel} · Sales Director performance review`}
      />

      {/* Quarter picker */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-[11px] uppercase tracking-wider text-muted">Quarter</span>
        <div className="flex gap-1 rounded-xl bg-black/[0.06] p-1">
          {[1, 2, 3, 4].map((q) => (
            <Link
              key={q}
              href={`/sales/quarterly-review?year=${year}&quarter=${q}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${q === quarter ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:bg-black/[0.04]"}`}
            >
              Q{q}
            </Link>
          ))}
        </div>
        <select
          defaultValue={year}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          // Plain navigation on change via a tiny inline form-less approach: links above
          // handle quarter; year uses an anchor list fallback below for no-JS safety.
          disabled
          aria-label="Year"
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="flex gap-1">
          {years.map((y) => (
            <Link key={y} href={`/sales/quarterly-review?year=${y}&quarter=${quarter}`} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${y === year ? "bg-black/[0.08] text-ink" : "text-muted hover:text-ink"}`}>{y}</Link>
          ))}
        </div>
      </div>

      {/* Live team snapshot — the performance context the review is scored against. */}
      <Card className="p-4 mb-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Sales team snapshot</h2>
          <span className="text-[11px] text-muted">context for {snap.periodLabel} · closed/pipeline are the latest connected figures</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Service advisors" value={String(snap.advisors)} sub={`${snap.withGoal}/${snap.advisors} with a goal set`} />
          <Stat label="Combined monthly goal" value={money(snap.teamTarget)} />
          <Stat label="Closed (YTD)" value={snap.closedYtd != null ? money(snap.closedYtd) : "—"} sub={attainmentPct != null ? `${attainmentPct}% of monthly goal` : "no feed connected"} />
          <Stat label="Open pipeline" value={snap.pipeline != null ? money(snap.pipeline) : "—"} />
        </div>
        {snap.byBranch.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-2 py-2 font-medium">Branch</th>
                  <th className="px-2 py-2 font-medium text-right">Advisors</th>
                  <th className="px-2 py-2 font-medium text-right">Goals set</th>
                  <th className="px-2 py-2 font-medium text-right">Monthly goal</th>
                  <th className="px-2 py-2 font-medium text-right">Closed</th>
                </tr>
              </thead>
              <tbody>
                {snap.byBranch.map((b) => (
                  <tr key={b.branch} className="border-b border-line last:border-0">
                    <td className="px-2 py-2">{b.label}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{b.advisors}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{b.withGoal}/{b.advisors}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(b.target)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{b.closed != null ? money(b.closed) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!snap.hasActuals ? (
          <p className="mt-3 text-[11px] text-amber-700">
            No closed/pipeline feed is connected yet, so dollar actuals show &ldquo;—&rdquo;. Goals and advisor counts are live;
            fill the closed figures in the scorecard notes until SmarterLaunch / the sales feed is connected.
          </p>
        ) : null}
      </Card>

      <SalesReviewForm
        metrics={SALES_REVIEW_METRICS}
        sections={SALES_REVIEW_SECTIONS}
        periodLabel={snap.periodLabel}
        directorDefault={""}
        reviewerDefault={user.name ?? ""}
      />
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-xl font-light tabular-nums text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
