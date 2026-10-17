"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { money } from "@/lib/format";
import MetricInfo from "@/components/MetricInfo";
import { hasMetric } from "@/lib/metrics-registry";
import { rampColor, rampTextColor } from "@/components/motivation";
import type { Benchmarks, BenchMetric, BenchUnit } from "@/lib/benchmarking";
import type { BranchForecast, Projection, PaceStatus, BookOutlook } from "@/lib/forecasting";

// Client renderer for Branch Benchmarking: a sortable cross-branch league table
// on the canonical metrics (leader/laggard emphasis — the Signal ramp on
// attainment/pass-rate/compliance columns, honest rank emphasis elsewhere), plus
// a compact year-end pacing / forecast panel. Brand tokens + ui primitives only.

function fmt(v: number | null, unit: BenchUnit): string {
  if (v == null) return "—";
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit === "count") return Math.round(v).toLocaleString("en-US");
  if (unit === "ratio") return v.toFixed(2);
  return money(v);
}

const moneyK = (n: number | null) =>
  n == null ? "—" : Math.abs(n) >= 1_000_000 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;

// ---- League table ----------------------------------------------------------
export default function BenchmarkingClient({
  benchmarks,
  forecasts,
  book,
}: {
  benchmarks: Benchmarks;
  forecasts: BranchForecast[];
  book: BookOutlook;
}) {
  const [sortKey, setSortKey] = useState<string>(benchmarks.metrics[0]?.key ?? "");
  const metricByKey = useMemo(
    () => new Map(benchmarks.metrics.map((m) => [m.key, m])),
    [benchmarks.metrics],
  );

  // Row order follows the selected metric's rank (nulls sink to the bottom).
  const rows = useMemo(() => {
    const m = metricByKey.get(sortKey);
    const order = [...benchmarks.branches];
    if (!m) return order;
    const rankOf = new Map(m.values.map((v) => [v.branch, v.rank]));
    return order.sort((a, b) => {
      const ra = rankOf.get(a.key);
      const rb = rankOf.get(b.key);
      if (ra == null && rb == null) return 0;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return ra - rb;
    });
  }, [sortKey, metricByKey, benchmarks.branches]);

  return (
    <div className="space-y-6">
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
            <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
            League table · {benchmarks.periodLabel} · YTD
          </h2>
          <span className="text-[11px] text-muted">Tap a metric to sort · 🥇 chip = leader</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left align-bottom">
                <th className="sticky left-0 z-10 bg-surface px-4 py-2.5 text-xs font-medium text-muted">Branch</th>
                {benchmarks.metrics.map((m) => {
                  const active = m.key === sortKey;
                  return (
                    <th key={m.key} className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setSortKey(m.key)}
                          className={`inline-flex items-center gap-1 rounded text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? "text-brand-700" : "text-muted hover:text-ink"}`}
                          aria-pressed={active}
                          title={`Sort by ${m.label}`}
                        >
                          <span className="whitespace-nowrap">{m.label}</span>
                          <SortGlyph active={active} />
                        </button>
                        {hasMetric(m.registryKey) ? (
                          <MetricInfo metricKey={m.registryKey} srHint={m.label} />
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[10px] font-normal text-muted">
                        {m.higherIsBetter ? "higher better" : "lower better"}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.key} className="border-b border-line last:border-0 hover:bg-black/[0.015]">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 font-medium text-ink whitespace-nowrap">
                    {b.label}
                  </td>
                  {benchmarks.metrics.map((m) => {
                    const v = m.values.find((x) => x.branch === b.key)!;
                    return (
                      <td key={m.key} className="px-3 py-2.5 text-right align-middle">
                        <Cellage v={v} metric={m} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-black/[0.02] text-[11px] text-muted">
                <td className="sticky left-0 z-10 bg-[#f6f8f7] px-4 py-2 font-medium">Company median</td>
                {benchmarks.metrics.map((m) => (
                  <td key={m.key} className="px-3 py-2 text-right tabular-nums">{fmt(m.median, m.unit)}</td>
                ))}
              </tr>
              <tr className="bg-black/[0.02] text-[11px] text-muted">
                <td className="sticky left-0 z-10 bg-[#f6f8f7] px-4 py-2 font-medium">Best</td>
                {benchmarks.metrics.map((m) => (
                  <td key={m.key} className="px-3 py-2 text-right tabular-nums text-ink">{fmt(m.best, m.unit)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-muted">
          Figures are YTD through {benchmarks.periodLabel}. Each column is one canonical metric — tap the
          “What is this number?” info dot for its definition, source and owner. Chemical % is not benchmarked:
          the MBR carries chemical company-wide only, with no per-branch split, so a branch figure would be fabricated.
        </p>
      </Card>

      <ForecastPanel forecasts={forecasts} book={book} year={benchmarks.year} />
    </div>
  );
}

function SortGlyph({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-3 w-3 ${active ? "text-brand-700" : "text-muted/50"}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
  );
}

// One league-table cell. Ramp metrics (attainment / pass-rate / compliance) get a
// Signal-ramp meter; other metrics show the value with honest rank emphasis.
function Cellage({ v, metric }: { v: { value: number | null; rank: number | null; leader: boolean; laggard: boolean }; metric: BenchMetric }) {
  if (v.value == null) return <span className="text-muted">—</span>;
  const label = fmt(v.value, metric.unit);

  if (metric.isRamp) {
    const pct = Math.max(0, Math.min(100, v.value));
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          {v.leader ? <span aria-hidden="true">🥇</span> : null}
          <span className="tabular-nums font-medium" style={{ color: rampTextColor(pct) }}>{label}</span>
        </div>
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-black/[0.08]" aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: rampColor(pct) }} />
        </div>
      </div>
    );
  }

  // Non-ramp (rate / cost %): rank emphasis only — never a fake-green cost figure.
  const tone = v.leader ? "text-emerald-700 font-semibold" : v.laggard ? "text-red-600" : "text-ink";
  return (
    <div className="flex items-center justify-end gap-1.5">
      {v.leader ? <span aria-hidden="true">🥇</span> : null}
      <span className={`tabular-nums ${tone}`}>{label}</span>
      {v.rank != null ? (
        <span className="rounded-full bg-black/[0.06] px-1.5 py-0.5 text-[10px] tabular-nums text-muted">#{v.rank}</span>
      ) : null}
    </div>
  );
}

// ---- Pacing / forecast panel ----------------------------------------------
const STATUS_META: Record<PaceStatus, { label: string; cls: string }> = {
  ahead: { label: "Ahead of pace", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  on_pace: { label: "On pace", cls: "bg-brand-50 text-brand-700 border-brand-200" },
  behind: { label: "Behind pace", cls: "bg-red-50 text-red-600 border-red-200" },
  no_data: { label: "No data yet", cls: "bg-black/[0.04] text-muted border-line" },
};

function ForecastPanel({ forecasts, book, year }: { forecasts: BranchForecast[]; book: BookOutlook; year: number }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
          Pacing to year-end · {year}
        </h2>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8F6400]">
          Estimates · projection
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {forecasts.map((f) => (
          <Card key={f.scope} className={`p-4 ${f.scope === "company" ? "ring-1 ring-brand-200" : ""}`}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink">{f.label}</h3>
              {f.scope === "company" ? <span className="text-[10px] uppercase tracking-wide text-muted">company</span> : null}
            </div>
            <div className="space-y-3">
              {f.projections.map((p) => (
                <ProjectionRow key={p.kpi} p={p} />
              ))}
            </div>
            {f.scope === "company" && book.projected12mo != null ? (
              <div className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-muted">
                Forward recurring book (est. +12 mo):{" "}
                <span className="tabular-nums text-ink">{moneyK(book.projected12mo)}</span>
                {book.impliedAnnualGrowthPct != null ? (
                  <> · implied {book.impliedAnnualGrowthPct >= 0 ? "+" : ""}{book.impliedAnnualGrowthPct.toFixed(1)}%/yr</>
                ) : null}{" "}
                — projection from trailing book growth.
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Projections carry the YTD attainment run-rate across the remaining budgeted months (so seasonality in the
        budget is respected). They are estimates, not actuals — status compares projected full-year vs. budget,
        direction-aware (cancellations are better below budget).
      </p>
    </section>
  );
}

function ProjectionRow({ p }: { p: Projection }) {
  const s = STATUS_META[p.status];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{p.label}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="text-lg font-light tabular-nums text-ink">{moneyK(p.projectedFullYear)}</span>
        <span className="text-[11px] text-muted">
          est. year-end{p.fullYearBudget != null ? <> vs {moneyK(p.fullYearBudget)} bdgt</> : null}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted">
        {p.postedMonths > 0 ? (
          <>
            {p.postedMonths} mo posted · YTD {p.attainmentPct != null ? `${p.attainmentPct.toFixed(0)}%` : "—"} of budget
            {p.projectedAttainmentPct != null ? <> · proj {p.projectedAttainmentPct.toFixed(0)}%</> : null}
          </>
        ) : (
          "No posted months yet"
        )}
      </div>
    </div>
  );
}
