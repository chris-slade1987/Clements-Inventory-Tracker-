import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";
import { buildScorecardRows, scoreFromSaved, bonusEarned, MANAGER_BONUS_TARGET } from "@/lib/scorecard";
import { money } from "@/lib/format";
import ScorecardSignClient from "./ScorecardSignClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review & sign your scorecard — CanopyOS" };

const fmt = (v: number | null, unit: string | null) =>
  v == null ? "—" : unit === "pct" ? `${v.toFixed(1)}%` : unit === "count" ? Math.round(v).toLocaleString() : money(v);

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">{children}</div>;
}

export default async function ScorecardSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const review = await prisma.scorecardReview.findUnique({ where: { signToken: token }, include: { signatures: true } });

  let body: React.ReactNode;
  if (!review) {
    body = <Panel><p className="text-sm text-slate-600">This signing link is not valid or has already been used. Please contact your supervisor or HR.</p></Panel>;
  } else if (review.status === "archived") {
    body = <Panel><h2 className="text-lg font-semibold text-slate-900">Already signed</h2><p className="mt-1 text-sm text-slate-600">This scorecard is complete and on file. No further action is needed.</p></Panel>;
  } else {
    const b = branchLabel(review.branch);
    const rows = await buildScorecardRows(review.year, review.quarter, review.branch);
    // The weighted score exactly as it will be filed/paid (saved Met rows only),
    // and the dollar bonus it earns from the fixed quarterly pool.
    const score = await scoreFromSaved(review.year, review.quarter, review.branch);
    const bonus = bonusEarned(score);
    const narrative: { label: string; v: string | null }[] = [
      { label: "Overall performance", v: review.overallNotes },
      { label: "Strengths", v: review.strengths },
      { label: "Areas for improvement", v: review.areas },
      { label: "Goals for next quarter", v: review.goals },
    ];
    body = (
      <Panel>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">Quarterly Branch Scorecard</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{b} · Q{review.quarter} {review.year}</h2>
            {review.managerName ? <p className="text-sm text-slate-500">{review.managerName}</p> : null}
          </div>
          <div className="shrink-0 rounded-xl bg-emerald-50 px-4 py-2.5 text-right ring-1 ring-emerald-100">
            <div className="text-2xl font-bold leading-none tabular-nums text-emerald-700">{score}%</div>
            <div className="mt-1 text-[12px] font-medium text-emerald-800">earned {money(bonus)}</div>
            <div className="text-[10px] uppercase tracking-wide text-emerald-600/80">of {money(MANAGER_BONUS_TARGET)} bonus</div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Metric</th>
                <th className="py-1.5 pr-3 font-medium text-right">Actual</th>
                <th className="py-1.5 pr-3 font-medium text-right">Target</th>
                <th className="py-1.5 font-medium text-center">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const met = r.met ?? r.suggested;
                return (
                  <tr key={r.key} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 pr-3 text-slate-800">{r.label}<span className="ml-1 text-[11px] text-slate-400">({r.weight}%)</span></td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-800">{r.type === "auto" ? fmt(r.actual, r.unit) : "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{r.budgetTarget != null ? fmt(r.budgetTarget, r.unit) : (r.target || "—")}</td>
                    <td className="py-1.5 text-center">{met == null ? <span className="text-slate-400">—</span> : met ? <span className="font-medium text-emerald-700">Met</span> : <span className="font-medium text-red-600">Not</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {narrative.some((n) => n.v) ? (
          <div className="mt-4 space-y-2">
            {narrative.filter((n) => n.v).map((n) => (
              <div key={n.label}><div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{n.label}</div><p className="whitespace-pre-wrap text-sm text-slate-800">{n.v}</p></div>
            ))}
          </div>
        ) : null}

        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="mb-2 text-sm font-semibold text-slate-900">Your signature</div>
          <ScorecardSignClient token={token} />
        </div>
      </Panel>
    );
  }

  return (
    <div className="min-h-screen bg-forest-grad px-4 py-10 flex justify-center">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/canopyos-wordmark.png" alt="CanopyOS" className="h-12 w-auto" />
        </div>
        {body}
      </div>
    </div>
  );
}
