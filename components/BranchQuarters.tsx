import { Card } from "@/components/ui";
import { money } from "@/lib/format";
import { BRANCH_KPI_KEYS, BRANCH_KPI_LABEL, type BranchKpiKey, type QuarterCell } from "@/lib/branch-kpis";

// Quarter view for the Branch / Company KPIs dashboard — a focused budget-vs-actual
// read of the three KPIs that have true monthly history (Production, New Sales,
// Cancellations), summed over a completed quarter. Shown when a "Qn" period is
// picked in the Controls; the YTD-only metrics (margin, stops, wages, chemical,
// fuel) are intentionally omitted here since the model stores them year-to-date.
// Presentational + server-safe (no client hooks).

// Cancellations is a cost — LOWER actual vs target is favorable; the other two
// are revenue (higher is better).
const HIGHER_IS_BETTER: Record<BranchKpiKey, boolean> = {
  production: true,
  new_sales: true,
  cancellations: false,
};

function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export default function BranchQuarters({
  scopeLabel,
  quarterLabel,
  cells,
}: {
  scopeLabel: string;
  quarterLabel: string;
  cells: Record<BranchKpiKey, QuarterCell>;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">{quarterLabel} · {scopeLabel}</h2>
        <p className="text-[11px] text-muted">Quarter to date, summed from monthly actuals vs. budget.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {BRANCH_KPI_KEYS.map((key) => {
          const c = cells[key];
          const higher = HIGHER_IS_BETTER[key];
          const variance = c.actual != null && c.target != null ? c.actual - c.target : null;
          const favorable = variance == null ? null : higher ? variance >= 0 : variance <= 0;
          const varPct = variance != null && c.target ? (variance / Math.abs(c.target)) * 100 : null;

          return (
            <Card key={key} className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{BRANCH_KPI_LABEL[key]}</div>
              <div className="mt-1 text-2xl font-light tabular-nums text-ink">{money(c.actual)}</div>
              <div className="mt-0.5 text-xs text-muted">Budget {money(c.target)}</div>
              {variance != null ? (
                <div
                  className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    favorable ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  }`}
                >
                  {variance >= 0 ? "+" : "−"}{money(Math.abs(variance))}
                  {varPct != null ? <span className="opacity-80">({pct(varPct)})</span> : null}
                  <span className="opacity-80">{favorable ? "favorable" : "unfavorable"}</span>
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-muted">No data for this quarter yet.</div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
