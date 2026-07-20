import { Card, PageHeader, EmptyState } from "@/components/ui";
import { redirect } from "next/navigation";
import { requireUser, isBoardObserver } from "@/lib/auth";
import { money } from "@/lib/format";
import {
  INSURANCE_LINES, PAYMENT_FREQUENCIES, lineLabel,
  listPoliciesByLine, annualCostByLine, upcomingRenewals, monthlyForecast, insuranceSummary,
} from "@/lib/insurance";
import InsuranceClient, { type Policy } from "./InsuranceClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insurance — Clements Command & Control" };

const MONTH_LABEL = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
};
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export default async function InsurancePage() {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  if (user.role !== "admin" && user.role !== "manager") {
    return (
      <>
        <PageHeader title="Insurance" subtitle="Policies, renewals & payment forecasting" />
        <EmptyState title="Managers only" hint="Ask an admin or manager for access to the insurance module." />
      </>
    );
  }

  const [groups, costs, renewals, forecast, summary] = await Promise.all([
    listPoliciesByLine(), annualCostByLine(), upcomingRenewals(90), monthlyForecast(12), insuranceSummary(),
  ]);

  const policiesByLine: { key: string; label: string; policies: Policy[] }[] = groups.map((g) => ({
    key: g.key, label: g.label,
    policies: g.policies.map((p) => ({
      id: p.id, line: p.line, name: p.name, carrier: p.carrier, policyNumber: p.policyNumber, agent: p.agent, status: p.status,
      effectiveDate: iso(p.effectiveDate), expirationDate: iso(p.expirationDate), annualPremium: p.annualPremium, notes: p.notes,
      paymentMethod: p.paymentMethod, paymentFrequency: p.paymentFrequency, downPayment: p.downPayment, numberOfPayments: p.numberOfPayments,
      paymentAmount: p.paymentAmount, apr: p.apr, financeCompany: p.financeCompany, financeAccount: p.financeAccount, needsReview: p.needsReview,
      documents: p.documents.map((d) => ({ id: d.id, title: d.title, filePath: d.filePath, category: d.category })),
      installmentCount: p.installments.length,
    })),
  }));

  const maxMonth = Math.max(1, ...forecast.series.map((m) => m.total));

  return (
    <>
      <PageHeader title="Insurance" subtitle="Every line of business — renewals, annual cost, and monthly payment forecast" />

      {/* Summary tiles */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Tile label="Annual premium" value={money(summary.totalAnnual)} />
        <Tile label="Active policies" value={String(summary.activeCount)} />
        <Tile label="Renewals · 90 days" value={String(summary.renewalsCount)} tone={summary.renewalsCount > 0 ? "warn" : undefined} />
        <Tile label="Due this month" value={money(summary.thisMonthDue)} />
      </div>

      {/* Upcoming renewals */}
      {renewals.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5 ring-1 ring-amber-200">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Upcoming renewals</div>
          <ul className="divide-y divide-line">
            {renewals.map((r) => {
              const overdue = r.daysOut < 0;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{lineLabel(r.line)}</span>
                  <span className="text-sm text-ink">{r.name}</span>
                  {r.carrier ? <span className="text-xs text-muted">· {r.carrier}</span> : null}
                  <span className={`ml-auto text-xs font-medium ${overdue ? "text-red-600" : r.daysOut <= 30 ? "text-amber-600" : "text-muted"}`}>
                    {overdue ? "expired" : "renews"} {r.expirationDate!.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                    {!overdue ? ` · ${r.daysOut}d` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2 mb-5">
        {/* Annual cost by line */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div className="text-sm font-medium text-ink">Annual cost by line</div>
            <div className="text-xs font-semibold text-ink tabular-nums">{money(costs.grandTotal)}/yr</div>
          </div>
          {costs.lines.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No premiums recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {costs.lines.map((l) => (
                <li key={l.key} className="px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink">{l.label}</span>
                    <span className="text-sm tabular-nums text-ink">{money(l.total)}</span>
                  </div>
                  {l.policies.length > 1 ? (
                    <ul className="mt-1 space-y-0.5">
                      {l.policies.map((p) => (
                        <li key={p.id} className="flex items-center justify-between text-xs text-muted">
                          <span className="truncate">{p.carrier ? `${p.carrier}` : p.name}{p.needsReview ? " · review" : ""}</span>
                          <span className="tabular-nums">{money(p.premium)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Monthly payment forecast */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-ink">Monthly payment forecast</div>
            <div className="text-xs text-muted tabular-nums">next 12 mo · {money(forecast.total)}</div>
          </div>
          {forecast.total === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No scheduled payments in the next 12 months.</p>
          ) : (
            <div className="space-y-1.5">
              {forecast.series.map((m) => (
                <div key={m.month} className="flex items-center gap-3">
                  <div className="w-12 shrink-0 text-xs text-muted tabular-nums">{MONTH_LABEL(m.month)}</div>
                  <div className="flex-1 h-5 rounded bg-black/[0.04] overflow-hidden">
                    <div className="h-full bg-emerald-grad rounded" style={{ width: `${(m.total / maxMonth) * 100}%` }} />
                  </div>
                  <div className="w-20 shrink-0 text-right text-xs tabular-nums text-ink">{m.total > 0 ? money(m.total) : "—"}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Policies + upload/add actions */}
      <InsuranceClient
        lines={INSURANCE_LINES.map((l) => ({ key: l.key, label: l.label }))}
        freqs={PAYMENT_FREQUENCIES.map((f) => ({ key: f.key, label: f.label }))}
        policiesByLine={policiesByLine}
      />
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${tone === "warn" ? "text-amber-600" : ""}`}>{value}</div>
    </Card>
  );
}
