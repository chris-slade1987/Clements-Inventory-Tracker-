import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import PrintButton from "@/components/PrintButton";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { appUrl } from "@/lib/app-url";
import { SALES_REVIEW_METRICS, SALES_REVIEW_SECTIONS, DIRECTOR_PROFILE } from "@/lib/sales-review";
import { quarterlyBonusBreakdown, nextMonthPeek, monthLabel, MIN_BONUS_TIER } from "@/lib/sales-review-data";
import { getSalesReview, parseSnapshot, parseDraft, lastSalesReviewSignEmail, resolveDirector } from "@/lib/sales-review-store";
import SalesReviewForm, { type PerfGroup, type Persisted } from "./SalesReviewForm";

export const dynamic = "force-dynamic";

// Quarterly Sales Director Review — housed in the Sales section. Scored squarely on
// the hard branch sales data mapped to the agreement's bonus tiers (the performance
// table), with a short set of role intangibles, notes, and sign-off. Reviewer = COO;
// subject = the Director of Sales. See lib/sales-review.ts + lib/sales-review-data.ts.
export default async function SalesQuarterlyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const user = await requireUser();
  // Super admins only (Chris, Julie, April) — they access, fill, and submit this
  // review. The Director signs via an emailed link in the sign-off workflow, not here.
  if (!isSuperAdmin(user)) redirect("/me");

  const sp = await searchParams;
  const now = new Date();
  const curYear = now.getFullYear();
  const curQuarter = Math.floor(now.getMonth() / 3) + 1;
  // Default to Q3 2026 (Howard's first reviewable quarter) when nothing is picked.
  const year = Number(sp.year) || (curYear === 2026 ? 2026 : curYear);
  const quarter = [1, 2, 3, 4].includes(Number(sp.quarter)) ? Number(sp.quarter) : (year === 2026 ? 3 : curQuarter);
  const periodLabel = `Q${quarter} ${year}`;

  const breakdown = quarterlyBonusBreakdown(year, quarter);
  const octPeek = nextMonthPeek(year, quarter);

  // Group by BRANCH, months nested underneath (Stuart → Aug, Sep; Naples → …).
  const perfGroups: PerfGroup[] = breakdown.branches.map((b) => ({
    label: b.label,
    totalSales: b.totalSales,
    months: b.months.map((c) => ({
      id: `${b.branch}:${c.key}`,
      monthLabel: monthLabel(c.key).replace(` ${year}`, ""),
      target: MIN_BONUS_TIER,
      actual: c.sales,
      tierPct: c.pct,
      defaultHit: c.hit,
    })),
  }));
  const veroGroup = breakdown.vero
    ? { label: "Vero Beach", totalSales: breakdown.vero.totalSales, months: breakdown.vero.months.map((v) => ({ monthLabel: v.label, sales: v.sales })) }
    : null;

  // Persisted sign-off state (released → awaiting the Director → signed + filed).
  const [saved, director] = await Promise.all([getSalesReview(year, quarter), resolveDirector()]);
  let persisted: Persisted = null;
  if (saved) {
    const snap = parseSnapshot(saved.data);
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    const base = (appUrl() || (host ? `${proto}://${host}` : "")).replace(/\/$/, "");
    const lastEmail = await lastSalesReviewSignEmail(saved.id);
    persisted = {
      status: saved.status as "draft" | "released" | "signed",
      releasedAt: saved.releasedAt?.toISOString() ?? null,
      reviewerName: saved.reviewerName,
      directorName: saved.directorName,
      directorSignName: saved.directorSignName,
      directorSignedAt: saved.directorSignedAt?.toISOString() ?? null,
      signUrl: saved.signToken && base ? `${base}/sales-review-sign/${saved.signToken}` : null,
      lastEmail: lastEmail ? { status: lastEmail.status, at: lastEmail.at.toISOString(), error: lastEmail.error } : null,
      bonus: saved.bonus,
      draft: parseDraft(saved.draft),
      draftSavedAt: saved.draftSavedAt ? saved.draftSavedAt.getTime() : 0,
      snapshot: snap
        ? {
            hits: Object.fromEntries(snap.perfGroups.flatMap((g) => g.months.map((m) => [m.id, m.hit]))),
            metrics: Object.fromEntries(snap.intangibles.map((m) => [m.key, { score: m.score, note: m.note }])),
            answers: Object.fromEntries(snap.notes.map((n) => [n.key, n.answer])),
            rating: snap.rating,
            reviewDate: snap.reviewDate,
          }
        : null,
    };
  }

  const years = [curYear, curYear - 1, curYear - 2].filter((y, i, a) => a.indexOf(y) === i);
  if (!years.includes(2026)) years.push(2026);

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <Link href="/sales" className="text-xs font-medium text-brand-700 hover:underline">← Sales Team</Link>
        <PrintButton />
      </div>

      <PageHeader
        title="Quarterly Sales Director Review"
        subtitle={`${DIRECTOR_PROFILE.name} · ${DIRECTOR_PROFILE.title} · ${periodLabel}`}
      />

      {/* Period picker + contract note */}
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-[11px] uppercase tracking-wider text-muted">Quarter</span>
        <div className="flex gap-1 rounded-xl bg-black/[0.06] p-1">
          {[1, 2, 3, 4].map((q) => (
            <Link key={q} href={`/sales/quarterly-review?year=${year}&quarter=${q}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${q === quarter ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:bg-black/[0.04]"}`}>Q{q}</Link>
          ))}
        </div>
        <div className="ml-1 flex gap-1">
          {years.map((y) => (
            <Link key={y} href={`/sales/quarterly-review?year=${y}&quarter=${quarter}`} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${y === year ? "bg-black/[0.08] text-ink" : "text-muted hover:text-ink"}`}>{y}</Link>
          ))}
        </div>
      </div>

      <p className="mb-4 text-xs text-muted">
        Bonus is scored on the three focus markets — <span className="font-medium text-ink">{DIRECTOR_PROFILE.focusMarkets.join(" · ")}</span>.
        Vero Beach is shown for context but excluded from the bonus. Year-1 target {DIRECTOR_PROFILE.bonusYear1Target}; the agreement notes
        meaningful bonus is not expected while the teams are being built. Step-up milestone: {DIRECTOR_PROFILE.stepUpMilestone}.
      </p>

      {breakdown.hasData ? (
        <SalesReviewForm
          perfGroups={perfGroups}
          veroGroup={veroGroup}
          octPeek={octPeek}
          bonusTarget={DIRECTOR_PROFILE.bonusYear1Target}
          metrics={SALES_REVIEW_METRICS}
          sections={SALES_REVIEW_SECTIONS}
          periodLabel={periodLabel}
          year={year}
          quarter={quarter}
          directorDefault={director.name || DIRECTOR_PROFILE.name}
          directorEmail={director.email}
          reviewerDefault={user.name ?? ""}
          persisted={persisted}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          No branch sales loaded for {periodLabel} yet. Q3 2026 (Aug–Sep) is loaded from the verified close-won export;
          other quarters populate once the sales feed is connected.
        </p>
      )}
    </>
  );
}
