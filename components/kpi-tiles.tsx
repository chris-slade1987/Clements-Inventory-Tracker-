import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { money } from "@/lib/format";
import type { Cell } from "@/lib/management";

// Shared, presentational KPI tiles (actual vs budget, variance chip, budget bar)
// used by both the Executive dashboard and the My Branch → Company KPIs view, so
// the company KPI view is rich on its own without re-deriving the pieces.

type Unit = "usd" | "pct" | "count";

export function fmtKpi(v: number | null, unit: Unit): string {
  if (v == null) return "—";
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit === "count") return Math.round(v).toLocaleString("en-US");
  return money(v);
}

/** Compact favorable/unfavorable variance chip (actual vs budget). */
export function VarianceChip({ c, unit }: { c: Cell; unit: Unit }) {
  if (c.variance == null || c.budget == null) return <div className="mt-1 text-[11px] text-muted">no budget</div>;
  const good = c.favorable === true;
  const sign = c.variance >= 0 ? "+" : "";
  const val =
    unit === "pct" ? `${sign}${c.variance.toFixed(1)} pts`
      : unit === "count" ? `${sign}${Math.round(c.variance).toLocaleString("en-US")}`
        : `${sign}${money(c.variance)}`;
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px]">
      <span className={`font-medium ${good ? "text-emerald-700" : "text-red-600"}`}>{val}</span>
      <span className="text-muted">vs {fmtKpi(c.budget, unit)} bdgt</span>
    </div>
  );
}

/** Actual-vs-budget fill bar — filled = actual (green favorable / red not), tick = budget. */
export function BudgetBar({ c }: { c: Cell }) {
  if (c.actual == null || c.budget == null || c.budget === 0) return null;
  const denom = Math.max(c.actual, c.budget) || 1;
  const aPct = Math.max(2, Math.min(100, (c.actual / denom) * 100));
  const bPct = Math.max(0, Math.min(100, (c.budget / denom) * 100));
  const good = c.favorable === true;
  return (
    <div className="relative mt-2 h-1.5 rounded-full bg-black/10">
      <div className={`absolute inset-y-0 left-0 rounded-full ${good ? "bg-emerald-500" : "bg-red-400"}`} style={{ width: `${aPct}%` }} />
      <div className="absolute -inset-y-[2px] w-px bg-black/50" style={{ left: `${bPct}%` }} title="budget" />
    </div>
  );
}

/** One KPI tile: label, big value, variance chip, budget bar, optional % of revenue
 *  and an optional footer slot (e.g. a full-year-forecast line). */
export function KpiTile({ label, c, unit, pctOfRev, footer }: { label: string; c: Cell; unit: Unit; pctOfRev?: number | null; footer?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
        {pctOfRev != null && Number.isFinite(pctOfRev) ? (
          <div className="shrink-0 text-[11px] text-muted tabular-nums">{pctOfRev.toFixed(1)}% of rev</div>
        ) : null}
      </div>
      <div className="mt-1 text-2xl font-light tabular-nums">{fmtKpi(c.actual, unit)}</div>
      <VarianceChip c={c} unit={unit} />
      <BudgetBar c={c} />
      {footer}
    </Card>
  );
}
