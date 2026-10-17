import "server-only";
import { prisma } from "@/lib/prisma";
import {
  BRANCHES,
  branchLabel,
  cell,
  periodValues,
  resolvePeriod,
  type Cell,
} from "@/lib/management";
import { fuelByBranch } from "@/lib/fuel";
import { getMetric } from "@/lib/metrics-registry";

// ===========================================================================
// Cross-branch benchmarking  —  CanopyOS vision Theme 10
// ===========================================================================
//
// A READ-ONLY aggregator that computes, for each of the four branches, the
// canonical metrics that are fair to compare across branches, then ranks them
// and reports the company best + median so a league table can highlight leaders
// and laggards. "One number, one source": EVERY metric here is sourced from the
// existing computation libs and tied to a key in lib/metrics-registry.ts (the
// column's "What is this number?" affordance reads that same registry entry).
//
// Honesty guardrails (docs/CANOPY-VISION.md §4):
//   - Nothing is fabricated. A metric with no per-branch source (e.g. chemical
//     expense, which the model carries company-wide only) is deliberately NOT in
//     the league table — see the note in docs/WORKFLOWS.md. No faked branch split.
//   - Attainment / pass-rate / compliance metrics (0–100, higher = good) carry an
//     `isRamp` flag so the UI may color them with the COO-approved Signal ramp.
//     Rate metrics where lower is better (attrition, cost % of revenue) do NOT
//     ramp — they rank only, so we never paint a cost figure "green".
//
// No Prisma writes, no schema changes — benchmarking is pure aggregation.
// ===========================================================================

export type BenchUnit = "pct" | "usd" | "count" | "ratio";

export type BranchValue = {
  branch: string;
  label: string;
  value: number | null;
  /** 1 = best for this metric's direction; null when the branch has no value. */
  rank: number | null;
  /** True for the single best-ranked branch with a value (league leader). */
  leader: boolean;
  /** True for the single worst-ranked branch with a value (laggard). */
  laggard: boolean;
};

export type BenchMetric = {
  /** Column key (unique on the page). */
  key: string;
  /** The canonical metrics-registry key this column is tied to (for MetricInfo). */
  registryKey: string;
  label: string;
  unit: BenchUnit;
  higherIsBetter: boolean;
  /** 0–100 attainment / pass-rate / compliance → eligible for the Signal ramp. */
  isRamp: boolean;
  /** One-line, plain-English note on exactly what this column measures. */
  note: string;
  values: BranchValue[];
  best: number | null;
  median: number | null;
  /** Spread between best and worst present value (variance made visible). */
  spread: number | null;
};

export type Benchmarks = {
  year: number;
  month: number;
  periodLabel: string;
  branches: { key: string; label: string }[];
  metrics: BenchMetric[];
};

// ---------------------------------------------------------------------------
// Small math helpers (null-safe).
// ---------------------------------------------------------------------------
function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pctOf(num: number | null, den: number | null): number | null {
  return num != null && den != null && den !== 0 ? (num / den) * 100 : null;
}

/**
 * Assemble a BenchMetric from a per-branch raw-value map: rank (competition
 * ranking, ties share a rank), flag leader/laggard, and compute best/median/spread.
 */
function makeMetric(
  def: { key: string; registryKey: string; label: string; unit: BenchUnit; higherIsBetter: boolean; isRamp: boolean; note: string },
  raw: Record<string, number | null>,
): BenchMetric {
  const present: { branch: string; value: number }[] = [];
  for (const b of BRANCHES) {
    const v = raw[b.key];
    if (v != null) present.push({ branch: b.key, value: v });
  }
  // Rank present branches by the metric's good-direction (competition ranking).
  const ordered = [...present].sort((a, b) => (def.higherIsBetter ? b.value - a.value : a.value - b.value));
  const rankByBranch = new Map<string, number>();
  ordered.forEach((row, i) => {
    if (i > 0 && row.value === ordered[i - 1].value) {
      rankByBranch.set(row.branch, rankByBranch.get(ordered[i - 1].branch)!);
    } else {
      rankByBranch.set(row.branch, i + 1);
    }
  });
  const bestRank = ordered.length ? rankByBranch.get(ordered[0].branch)! : null;
  const worstRank = ordered.length ? rankByBranch.get(ordered[ordered.length - 1].branch)! : null;
  const uniquePresent = present.length;
  const countAtRank = (r: number | null) => (r == null ? 0 : ordered.filter((o) => rankByBranch.get(o.branch) === r).length);

  const values: BranchValue[] = BRANCHES.map((b) => {
    const value = raw[b.key] ?? null;
    const rank = value != null ? rankByBranch.get(b.key) ?? null : null;
    return {
      branch: b.key,
      label: branchLabel(b.key),
      value,
      rank,
      // Only flag a single, unambiguous leader/laggard (never when 2+ branches tie
      // at the extreme, which would make "the leader" misleading).
      leader: value != null && rank === bestRank && countAtRank(bestRank) === 1 && uniquePresent > 1,
      laggard: value != null && rank === worstRank && countAtRank(worstRank) === 1 && uniquePresent > 1,
    };
  });

  const nums = present.map((p) => p.value);
  const best = nums.length ? (def.higherIsBetter ? Math.max(...nums) : Math.min(...nums)) : null;
  const spread = nums.length ? Math.max(...nums) - Math.min(...nums) : null;
  return { ...def, values, best, median: median(nums), spread };
}

// ---------------------------------------------------------------------------
// The aggregator.
// ---------------------------------------------------------------------------
/**
 * Compute the cross-branch league table for the latest loaded MBR period (or a
 * given "YYYY-MM"). Every metric is sourced from the shipped libs:
 *   - production / new-sales attainment, margin %, tech-wages %, attrition rate
 *     → MBR KpiValue (lib/management.ts), read YTD so partial months compare.
 *   - fuel % of revenue → real Coast-card spend (lib/fuel.ts) ÷ production.
 *   - QC pass rate → graded QcInspection pass/fail counts (lib/qc.ts domain).
 *   - checklist compliance → signed completions vs. misses (lib/checklists.ts domain).
 * Returns null when no MBR period is loaded (the page shows an empty state).
 */
export async function computeBenchmarks(periodKey?: string): Promise<Benchmarks | null> {
  const period = await resolvePeriod(periodKey);
  if (!period) return null;
  const { year, month } = period;
  const yearPrefix = `${year}-`;

  const [values, fuelMap, qcRows, completionRows, missRows] = await Promise.all([
    periodValues(period.id),
    fuelByBranch(year, month),
    prisma.qcInspection.groupBy({
      by: ["branch"],
      where: { periodKey: { startsWith: yearPrefix } },
      _sum: { passCount: true, failCount: true },
    }),
    prisma.checklistCompletion.groupBy({
      by: ["branch"],
      where: { periodKey: { startsWith: yearPrefix } },
      _count: { _all: true },
    }),
    prisma.checklistMiss.groupBy({
      by: ["branch"],
      where: { periodKey: { startsWith: yearPrefix } },
      _count: { _all: true },
    }),
  ]);

  const qcByBranch = new Map(qcRows.map((r) => [r.branch, r]));
  const completionByBranch = new Map(completionRows.map((r) => [r.branch, r._count._all]));
  const missByBranch = new Map(missRows.map((r) => [r.branch, r._count._all]));

  const get = (kpi: string, branch: string): Cell => cell(values, kpi, branch as never, "ytd");

  // ---- Build each metric's raw per-branch value map -----------------------
  const productionAttain: Record<string, number | null> = {};
  const newSalesAttain: Record<string, number | null> = {};
  const marginPct: Record<string, number | null> = {};
  const techWagesPct: Record<string, number | null> = {};
  const attritionRate: Record<string, number | null> = {};
  const fuelPct: Record<string, number | null> = {};
  const qcPass: Record<string, number | null> = {};
  const checklistCompliance: Record<string, number | null> = {};

  for (const b of BRANCHES) {
    const prod = get("production", b.key);
    productionAttain[b.key] = pctOf(prod.actual, prod.budget);

    const ns = get("new_sales", b.key);
    newSalesAttain[b.key] = pctOf(ns.actual, ns.budget);

    marginPct[b.key] = get("margin_pct", b.key).actual;

    const tw = get("tech_wages", b.key);
    techWagesPct[b.key] = pctOf(tw.actual, prod.actual);

    attritionRate[b.key] = get("attrition_rate", b.key).actual;

    const fuelYtd = fuelMap[b.key]?.ytd ?? null;
    fuelPct[b.key] = pctOf(fuelYtd, prod.actual);

    const qc = qcByBranch.get(b.key);
    const pass = qc?._sum.passCount ?? 0;
    const fail = qc?._sum.failCount ?? 0;
    qcPass[b.key] = pass + fail > 0 ? (pass / (pass + fail)) * 100 : null;

    const done = completionByBranch.get(b.key) ?? 0;
    const missed = missByBranch.get(b.key) ?? 0;
    checklistCompliance[b.key] = done + missed > 0 ? (done / (done + missed)) * 100 : null;
  }

  const metrics: BenchMetric[] = [
    makeMetric(
      { key: "production_attainment", registryKey: "production", label: "Production attainment", unit: "pct", higherIsBetter: true, isRamp: true, note: "Branch production revenue YTD as a % of its MBR budget (100% = on budget)." },
      productionAttain,
    ),
    makeMetric(
      { key: "new_sales_attainment", registryKey: "new_sales", label: "New-sales attainment", unit: "pct", higherIsBetter: true, isRamp: true, note: "Branch new-sales YTD as a % of its MBR budget (100% = on budget)." },
      newSalesAttain,
    ),
    makeMetric(
      { key: "margin_pct", registryKey: "margin_pct", label: "Margin %", unit: "pct", higherIsBetter: true, isRamp: false, note: "Net-after-labor as a % of production (the MBR margin definition), YTD." },
      marginPct,
    ),
    makeMetric(
      { key: "tech_wages_pct", registryKey: "tech_wages", label: "Tech wages % of rev", unit: "pct", higherIsBetter: false, isRamp: false, note: "Technician wages YTD as a % of branch production — lower is leaner." },
      techWagesPct,
    ),
    makeMetric(
      { key: "fuel_pct", registryKey: "fuel", label: "Fuel % of rev", unit: "pct", higherIsBetter: false, isRamp: false, note: "Real Coast-card fuel spend YTD as a % of branch production — lower is leaner." },
      fuelPct,
    ),
    makeMetric(
      { key: "attrition_rate", registryKey: "attrition_rate", label: "Attrition rate", unit: "pct", higherIsBetter: false, isRamp: false, note: "Cancellations as a % of the forward recurring book (YTD) — lower is better." },
      attritionRate,
    ),
    makeMetric(
      { key: "qc_pass_rate", registryKey: "qc_pass_rate", label: "QC pass rate", unit: "pct", higherIsBetter: true, isRamp: true, note: "Graded ride-behind QC items marked pass ÷ (pass + fail), this year." },
      qcPass,
    ),
    makeMetric(
      { key: "checklist_compliance", registryKey: "checklist_compliance", label: "Checklist compliance", unit: "pct", higherIsBetter: true, isRamp: true, note: "Signed oversight-checklist completions ÷ (completions + misses), this year." },
      checklistCompliance,
    ),
  ];

  return {
    year,
    month,
    periodLabel: period.label,
    branches: BRANCHES.map((b) => ({ key: b.key, label: b.label })),
    metrics,
  };
}

/** Defensive helper: confirm every benchmarked column has a live registry entry
 *  (used by the page so a renamed/removed registry key fails loudly, not silently). */
export function unmappedBenchmarkKeys(b: Benchmarks): string[] {
  return b.metrics.filter((m) => !getMetric(m.registryKey)).map((m) => m.registryKey);
}
