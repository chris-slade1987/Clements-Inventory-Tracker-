import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { getScorecardReview, matchBranchManagerEmployee, bonusEarned } from "@/lib/scorecard";
import { getSalesReview, parseDraft } from "@/lib/sales-review-store";
import { DIRECTOR_PROFILE } from "@/lib/sales-review";
import { money } from "@/lib/format";
import ScorecardTabs from "../ScorecardTabs";

export const dynamic = "force-dynamic";

// Scorecards · Overview — the super-admin dashboard over every quarterly review:
// the four branch-manager scorecards and the Sales Director review, one row each,
// with status, score, bonus and a link straight into the review.
type Status = "not_started" | "in_progress" | "awaiting" | "signed";
const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  awaiting: "Awaiting signature",
  signed: "Signed",
};
const STATUS_TONE: Record<Status, string> = {
  not_started: "bg-slate-100 text-slate-600",
  in_progress: "bg-amber-100 text-amber-800",
  awaiting: "bg-sky-100 text-sky-800",
  signed: "bg-emerald-100 text-emerald-800",
};

type Row = { key: string; person: string; role: string; status: Status; score: string; bonus: number | null; href: string };

export default async function ScorecardsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/management/scorecards");
  const sp = await searchParams;

  // Default to the most recently COMPLETED quarter — the one being reviewed now.
  const now = new Date();
  const curQ = Math.floor(now.getMonth() / 3) + 1;
  const defYear = curQ === 1 ? now.getFullYear() - 1 : now.getFullYear();
  const defQuarter = curQ === 1 ? 4 : curQ - 1;
  const year = Number(sp.year) || defYear;
  const quarter = [1, 2, 3, 4].includes(Number(sp.quarter)) ? Number(sp.quarter) : defQuarter;
  const q = `year=${year}&quarter=${quarter}`;

  const branchRows: Row[] = await Promise.all(
    BRANCHES.map(async (b) => {
      const [review, mgr] = await Promise.all([getScorecardReview(year, quarter, b.key), matchBranchManagerEmployee(b.key)]);
      const status: Status = !review ? "not_started" : review.status === "archived" ? "signed" : review.status === "final" ? "awaiting" : "in_progress";
      const score = review?.score ?? null;
      return {
        key: b.key,
        person: mgr?.name ?? review?.managerName ?? "—",
        role: `Branch Manager · ${branchLabel(b.key)}`,
        status,
        score: score != null ? `${score}%` : "—",
        bonus: status === "signed" && score != null ? bonusEarned(score) : null,
        href: `/management/scorecards?${q}&branch=${b.key}&view=branch`,
      };
    }),
  );

  const sr = await getSalesReview(year, quarter);
  const srDraft = sr ? parseDraft(sr.draft) : null;
  const srStatus: Status = !sr
    ? "not_started"
    : sr.status === "signed"
      ? "signed"
      : sr.status === "released"
        ? "awaiting"
        : srDraft
          ? "in_progress"
          : "not_started";
  const salesRow: Row = {
    key: "sales-director",
    person: sr?.directorName ?? DIRECTOR_PROFILE.name,
    role: DIRECTOR_PROFILE.title,
    status: srStatus,
    score: "—",
    bonus: sr && (srStatus === "awaiting" || srStatus === "signed") ? sr.bonus : null,
    href: `/management/scorecards/sales-director?${q}`,
  };

  const rows = [...branchRows, salesRow];
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const bonusOwed = rows.filter((r) => r.status === "signed").reduce((sum, r) => sum + (r.bonus ?? 0), 0);

  const years = [now.getFullYear(), now.getFullYear() - 1];
  return (
    <>
      <PageHeader title="Scorecards" subtitle={`Every quarterly review · Q${quarter} ${year}`} />
      <ScorecardTabs active="overview" isSuper year={year} quarter={quarter} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted">Quarter</span>
        <div className="flex gap-1 rounded-xl bg-black/[0.06] p-1">
          {[1, 2, 3, 4].map((n) => (
            <Link key={n} href={`/management/scorecards/overview?year=${year}&quarter=${n}`} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${n === quarter ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:bg-black/[0.04]"}`}>Q{n}</Link>
          ))}
        </div>
        <div className="ml-1 flex gap-1">
          {years.map((y) => (
            <Link key={y} href={`/management/scorecards/overview?year=${y}&quarter=${quarter}`} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${y === year ? "bg-black/[0.08] text-ink" : "text-muted hover:text-ink"}`}>{y}</Link>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["not_started", "in_progress", "awaiting", "signed"] as Status[]).map((s) => (
          <Card key={s} className="p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">{STATUS_LABEL[s]}</div>
            <div className="mt-1 text-2xl font-light tabular-nums text-ink">{count(s)}</div>
          </Card>
        ))}
        <Card className="p-3 col-span-2 sm:col-span-1">
          <div className="text-[11px] uppercase tracking-wider text-muted">Bonus to pay (signed)</div>
          <div className="mt-1 text-2xl font-light tabular-nums text-brand-700">{money(bonusOwed)}</div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Reviewed</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Score</th>
                <th className="px-3 py-2 font-medium text-right">Bonus</th>
                <th className="px-4 py-2 font-medium text-right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{r.person}</td>
                  <td className="px-3 py-3 text-muted">{r.role}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted">{r.score}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.bonus != null ? money(r.bonus) : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={r.href} className="text-xs font-medium text-brand-700 hover:underline">
                      {r.status === "not_started" ? "Start" : "Open"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-muted">
        Bonus shows once a review is released (Sales Director) or signed (branch managers); the total counts signed reviews only. New-hire 30/60-day reviews stay under{" "}
        <Link href="/people/reviews" className="text-brand-700 hover:underline">People → Reviews</Link>.
      </p>
    </>
  );
}
