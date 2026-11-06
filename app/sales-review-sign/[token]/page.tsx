import { prisma } from "@/lib/prisma";
import { money } from "@/lib/format";
import { parseSnapshot } from "@/lib/sales-review-store";
import { DIRECTOR_PROFILE } from "@/lib/sales-review";
import SalesReviewSignClient from "./SalesReviewSignClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review & sign your quarterly review — CanopyOS" };

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">{children}</div>;
}

// PUBLIC (token) page: the Sales Director reads the released quarterly review and
// e-signs. Renders purely from the snapshot stored at release (no recompute).
export default async function SalesReviewSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const review = await prisma.salesReview.findUnique({ where: { signToken: token } });
  const snap = review ? parseSnapshot(review.data) : null;

  let body: React.ReactNode;
  if (!review || !snap) {
    body = <Panel><p className="text-sm text-slate-600">This signing link is not valid or has already been used. Please contact the COO or HR.</p></Panel>;
  } else if (review.status === "signed") {
    body = <Panel><h2 className="text-lg font-semibold text-slate-900">Already signed</h2><p className="mt-1 text-sm text-slate-600">This review is complete and on file. No further action is needed.</p></Panel>;
  } else {
    body = (
      <Panel>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">Quarterly Sales Director Review</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{review.directorName ?? DIRECTOR_PROFILE.name} · {snap.periodLabel}</h2>
            <p className="text-sm text-slate-500">{DIRECTOR_PROFILE.title}{review.reviewerName ? ` · Reviewed by ${review.reviewerName}` : ""}</p>
          </div>
          <div className="shrink-0 rounded-xl bg-emerald-50 px-4 py-2.5 text-right ring-1 ring-emerald-100">
            <div className="text-2xl font-light leading-none tabular-nums text-emerald-700">{money(snap.bonus)}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-emerald-600/80">quarterly bonus</div>
          </div>
        </div>

        {/* Branch performance */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Month</th>
                <th className="py-1.5 pr-3 font-medium text-right">Target</th>
                <th className="py-1.5 pr-3 font-medium text-right">Actual</th>
                <th className="py-1.5 pr-3 font-medium text-center">Met?</th>
                <th className="py-1.5 font-medium text-right">Bonus</th>
              </tr>
            </thead>
            <tbody>
              {snap.perfGroups.map((g) => (
                <GroupRows key={g.branch} label={g.label} totalSales={g.totalSales} bonus={g.bonus}>
                  {g.months.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pl-5 pr-3 text-slate-600">{m.monthLabel}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{money(m.target)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-800">{money(m.actual)}</td>
                      <td className="py-1.5 pr-3 text-center">{m.hit ? <span className="font-medium text-emerald-700">Yes</span> : <span className="font-medium text-red-600">No</span>}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-800">{money(m.bonus)}</td>
                    </tr>
                  ))}
                </GroupRows>
              ))}
              {snap.veroGroup ? (
                <GroupRows label={`${snap.veroGroup.label} (excluded from bonus)`} totalSales={snap.veroGroup.totalSales} bonus={null}>
                  {snap.veroGroup.months.map((v, i) => (
                    <tr key={`v${i}`} className="border-b border-slate-100 last:border-0 text-slate-500">
                      <td className="py-1.5 pl-5 pr-3">{v.monthLabel}</td>
                      <td className="py-1.5 pr-3 text-right">—</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{money(v.sales)}</td>
                      <td className="py-1.5 pr-3 text-center">—</td>
                      <td className="py-1.5 text-right">—</td>
                    </tr>
                  ))}
                </GroupRows>
              ) : null}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200">
                <td colSpan={4} className="py-2 font-semibold text-slate-900">{snap.periodLabel} total bonus</td>
                <td className="py-2 text-right font-semibold tabular-nums text-emerald-700">{money(snap.bonus)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Intangibles */}
        {snap.intangibles.some((m) => m.score || m.note) ? (
          <div className="mt-5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Role &amp; leadership</div>
            <div className="mt-2 space-y-2">
              {snap.intangibles.filter((m) => m.score || m.note).map((m) => (
                <div key={m.key} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">{m.label}</span>
                    {m.score ? <span className="text-xs font-medium text-slate-700">{m.score}</span> : null}
                  </div>
                  {m.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{m.note}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Notes */}
        {snap.notes.some((n) => n.answer) ? (
          <div className="mt-5 space-y-3">
            {snap.notes.filter((n) => n.answer).map((n) => (
              <div key={n.key}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{n.label}</div>
                <p className="whitespace-pre-wrap text-sm text-slate-800">{n.answer}</p>
              </div>
            ))}
          </div>
        ) : null}

        {snap.rating ? (
          <p className="mt-5 text-sm text-slate-800"><span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Overall rating</span><br />{snap.rating}</p>
        ) : null}

        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="mb-2 text-sm font-semibold text-slate-900">Your signature</div>
          <SalesReviewSignClient token={token} defaultName={review.directorName ?? ""} />
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

function GroupRows({ label, totalSales, bonus, children }: { label: string; totalSales: number; bonus: number | null; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-emerald-50/50">
        <td colSpan={5} className="px-2 py-1.5">
          <span className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-semibold text-slate-900">{label}</span>
            <span className="text-[11px] tabular-nums text-slate-500">· {money(totalSales)} this quarter</span>
            {bonus != null ? <span className="ml-auto text-[11px] font-medium tabular-nums text-emerald-700">Bonus {money(bonus)}</span> : null}
          </span>
        </td>
      </tr>
      {children}
    </>
  );
}
