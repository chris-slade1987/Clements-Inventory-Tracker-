import "server-only";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { isoWeek, weekPeriodKey, mondayOf, fridayEndOf, weekPeriodLabel } from "@/lib/checklists";

// Branch Command — the branch manager's weekly cockpit. This module owns the
// domain catalog, metric status thresholds, the per-week data access, and the
// sign-off gating (the forced-feedback rule). See docs/BRANCH-COMMAND.md.
//
// Data is source-agnostic: WeeklyMetric/TechWeek rows carry source="upload"
// (weekly PestPac export, Phase 2), "api" (PestPac API / Claude routing, later),
// or "manual" (entered in-app). Nothing below cares which — it reads the tables.

export type DomainKey =
  | "production"
  | "route"
  | "retention"
  | "technician"
  | "compliance"
  | "inventory"
  | "sales";

export type MetricStatus = "good" | "warn" | "alarm" | "info";

export const DOMAINS: { key: DomainKey; label: string; blurb: string }[] = [
  { key: "production", label: "Production & pacing", blurb: "Is the branch on pace to the monthly budget?" },
  { key: "route", label: "Route & schedule integrity", blurb: "Stops per day, unserviced rescheduled, next week ready." },
  { key: "retention", label: "Customer retention", blurb: "Cancellations, save calls, callback / re-treat rate." },
  { key: "technician", label: "Technician oversight", blurb: "Each tech's production, unserviced, cancellations, callbacks." },
  { key: "compliance", label: "Compliance & safety", blurb: "FL 482 — ID cards, approved products, records complete." },
  { key: "inventory", label: "Inventory & finance", blurb: "Disbursements logged, receipts scanned, deposit made." },
  { key: "sales", label: "Sales & lead hygiene", blurb: "Lead follow-ups; 60+ day leads closed-lost." },
];

export const DOMAIN_LABEL: Record<DomainKey, string> = Object.fromEntries(
  DOMAINS.map((d) => [d.key, d.label]),
) as Record<DomainKey, string>;

// The checkoff items a manager attests to each week, grouped by domain. Stable
// ids so signed records keep mapping if labels are reworded. These are the
// "I personally confirmed this" sign-offs (distinct from the auto-fed metrics).
export type CommandItem = { id: string; domain: DomainKey; label: string };

export const COMMAND_ITEMS: CommandItem[] = [
  { id: "prod-review", domain: "production", label: "Reviewed weekly + MTD production against the monthly budget." },
  { id: "route-reschedule", domain: "route", label: "Every missed / unserviced account is rescheduled within 7 days." },
  { id: "route-nextweek", domain: "route", label: "Next week's technician schedules are set and techs are ready for Monday." },
  { id: "retention-cancels", domain: "retention", label: "Reviewed cancellations and made save calls where possible." },
  { id: "retention-callbacks", domain: "retention", label: "Reviewed callback / re-treat rate and addressed repeat offenders." },
  { id: "tech-review", domain: "technician", label: "Reviewed every technician's week (production, unserviced, cancellations, callbacks)." },
  { id: "compliance-check", domain: "compliance", label: "ID cards / licenses current, approved products only, use-records complete." },
  { id: "inventory-finance", domain: "inventory", label: "Logged chemical disbursements, scanned receipts, and made the deposit." },
  { id: "sales-leads", domain: "sales", label: "Followed up open leads and closed-lost anything 60+ days stale." },
];

// Default metric shape per domain so the scoreboard renders with known rows even
// before any upload/parse. value=null → shows as "—" (awaiting data). Targets and
// units drive the status classifier below.
export type MetricSeed = { key: string; domain: DomainKey; label: string; unit?: string; target?: number };

export const METRIC_SEEDS: MetricSeed[] = [
  { key: "production_mtd", domain: "production", label: "Production MTD", unit: "$" },
  { key: "production_week", domain: "production", label: "Production this week", unit: "$" },
  { key: "pacing_pct", domain: "production", label: "Pace to monthly budget", unit: "%", target: 100 },
  { key: "stops_per_day", domain: "route", label: "Avg stops / tech / day", unit: "per_day", target: 10 },
  { key: "unserviced_count", domain: "route", label: "Unserviced / missed accounts", unit: "count", target: 0 },
  { key: "unserviced_open", domain: "route", label: "Still unrescheduled (>7d risk)", unit: "count", target: 0 },
  { key: "cancellations_count", domain: "retention", label: "Cancellations this week", unit: "count", target: 0 },
  { key: "saves_count", domain: "retention", label: "Accounts saved", unit: "count" },
  { key: "callback_rate", domain: "retention", label: "Callback / re-treat rate", unit: "%", target: 3 },
  { key: "open_leads", domain: "sales", label: "Open leads", unit: "count" },
  { key: "stale_leads_60", domain: "sales", label: "Leads 60+ days stale", unit: "count", target: 0 },
];

// Classify a metric value to a scoreboard color. Lower-is-better metrics (rate,
// cancellations, unserviced) vs. higher-is-better (pace). Driven by `target`.
export function classifyMetric(key: string, value: number | null | undefined, target?: number | null): MetricStatus {
  if (value == null) return "info";
  switch (key) {
    case "callback_rate":
      return value < 3 ? "good" : value <= 6 ? "warn" : "alarm";
    case "pacing_pct":
      return value >= 100 ? "good" : value >= 90 ? "warn" : "alarm";
    case "stops_per_day":
      return value >= 8 ? "good" : value >= 6 ? "warn" : "alarm";
    case "unserviced_open":
      return value === 0 ? "good" : value <= 3 ? "warn" : "alarm";
    case "cancellations_count":
    case "unserviced_count":
    case "stale_leads_60":
      if (target != null) return value <= target ? "good" : value <= target + 5 ? "warn" : "alarm";
      return "info";
    default:
      return "info";
  }
}

const STATUS_RANK: Record<MetricStatus, number> = { alarm: 3, warn: 2, good: 1, info: 0 };
export function worstStatus(a: MetricStatus, b: MetricStatus): MetricStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export function classifyTech(t: { production?: number | null; productionTarget?: number | null; callbackRate?: number | null; stopsPerDay?: number | null }): MetricStatus {
  let s: MetricStatus = "good";
  if (t.production != null && t.productionTarget != null && t.productionTarget > 0) {
    const pace = (t.production / t.productionTarget) * 100;
    s = worstStatus(s, pace >= 100 ? "good" : pace >= 85 ? "warn" : "alarm");
  }
  if (t.callbackRate != null) s = worstStatus(s, t.callbackRate < 3 ? "good" : t.callbackRate <= 6 ? "warn" : "alarm");
  if (t.stopsPerDay != null) s = worstStatus(s, t.stopsPerDay >= 8 ? "good" : t.stopsPerDay >= 6 ? "warn" : "alarm");
  return s;
}

export const BRANCH_KEYS = BRANCHES.map((b) => b.key);

export function currentPeriodKey(date: Date = new Date()): string {
  return weekPeriodKey(date);
}

/** Runtime loader: find-or-create the open BranchWeek for a branch + week, seeding
 *  the default metric rows so the scoreboard always has a shape. Idempotent. */
export async function ensureBranchWeek(branch: string, date: Date = new Date()) {
  const periodKey = weekPeriodKey(date);
  let bw = await prisma.branchWeek.findUnique({ where: { branch_periodKey: { branch, periodKey } } });
  if (!bw) {
    bw = await prisma.branchWeek
      .create({
        data: {
          branch,
          periodKey,
          weekStart: mondayOf(date),
          weekEnd: fridayEndOf(date),
          status: "open",
        },
      })
      .catch(async () => prisma.branchWeek.findUnique({ where: { branch_periodKey: { branch, periodKey } } }));
  }
  if (!bw) throw new Error("Could not open the branch week.");
  // Seed any missing default metric rows (add-only; never overwrites fed values).
  const existing = await prisma.weeklyMetric.findMany({ where: { branchWeekId: bw.id }, select: { key: true } });
  const have = new Set(existing.map((m) => m.key));
  const missing = METRIC_SEEDS.filter((m) => !have.has(m.key));
  if (missing.length) {
    await prisma.weeklyMetric
      .createMany({
        data: missing.map((m) => ({
          branchWeekId: bw!.id,
          domain: m.domain,
          key: m.key,
          label: m.label,
          unit: m.unit ?? null,
          target: m.target ?? null,
          status: "info",
          source: "manual",
        })),
      })
      .catch(() => {});
  }
  return bw;
}

export type DomainScore = {
  key: DomainKey;
  label: string;
  blurb: string;
  status: MetricStatus;
  metrics: { key: string; label: string; value: number | null; displayValue: string | null; unit: string | null; target: number | null; status: MetricStatus }[];
  items: { id: string; label: string; checked: boolean }[];
  itemsComplete: boolean;
};

export function formatMetric(value: number | null, unit: string | null, display: string | null): string {
  if (display) return display;
  if (value == null) return "—";
  if (unit === "$") return `$${Math.round(value).toLocaleString()}`;
  if (unit === "%") return `${Math.round(value)}%`;
  if (unit === "per_day") return value.toFixed(1);
  return value.toLocaleString();
}

/** Assemble the full weekly view: scoreboard by domain, per-tech cards, findings,
 *  and the sign-off gate. */
export async function getBranchCommand(branch: string, date: Date = new Date()) {
  const bw = await ensureBranchWeek(branch, date);
  const [metrics, techWeeks, findings] = await Promise.all([
    prisma.weeklyMetric.findMany({ where: { branchWeekId: bw.id } }),
    prisma.techWeek.findMany({ where: { branchWeekId: bw.id }, orderBy: [{ status: "asc" }, { techName: "asc" }] }),
    prisma.commandFinding.findMany({ where: { branchWeekId: bw.id }, orderBy: { createdAt: "asc" } }),
  ]);

  const itemResults: { itemId: string; checked: boolean; note?: string }[] = bw.itemResults
    ? safeParse(bw.itemResults)
    : [];
  const checkedSet = new Set(itemResults.filter((r) => r.checked).map((r) => r.itemId));

  const scoreboard: DomainScore[] = DOMAINS.map((d) => {
    const dMetrics = metrics
      .filter((m) => m.domain === d.key)
      .map((m) => {
        const status = (m.status as MetricStatus) || classifyMetric(m.key, m.value, m.target);
        return {
          key: m.key,
          label: m.label,
          value: m.value,
          displayValue: m.displayValue,
          unit: m.unit,
          target: m.target,
          status,
        };
      });
    const items = COMMAND_ITEMS.filter((it) => it.domain === d.key).map((it) => ({
      id: it.id,
      label: it.label,
      checked: checkedSet.has(it.id),
    }));
    // Technician domain status is driven by the per-tech cards, not branch metrics.
    let status: MetricStatus = "info";
    if (d.key === "technician") {
      status = techWeeks.reduce<MetricStatus>((acc, t) => worstStatus(acc, (t.status as MetricStatus) || "info"), "info");
    } else {
      status = dMetrics.reduce<MetricStatus>((acc, m) => worstStatus(acc, m.status), "info");
    }
    return {
      key: d.key,
      label: d.label,
      blurb: d.blurb,
      status,
      metrics: dMetrics,
      items,
      itemsComplete: items.every((i) => i.checked),
    };
  });

  const openFindings = findings.filter((f) => f.requiresResponse && f.status === "open");
  const unreviewedTechs = techWeeks.filter((t) => !t.reviewed);
  const allItemsChecked = COMMAND_ITEMS.every((it) => checkedSet.has(it.id));

  const gate = {
    openFindings: openFindings.length,
    unreviewedTechs: unreviewedTechs.length,
    uncheckedItems: COMMAND_ITEMS.length - checkedSet.size,
    canSign:
      bw.status !== "signed" && openFindings.length === 0 && unreviewedTechs.length === 0 && allItemsChecked,
  };

  return { branchWeek: bw, scoreboard, techWeeks, findings, itemResults, gate };
}

export function attestationText(name: string, branch: string, date: Date = new Date()): string {
  return `I, ${name}, verify that I have reviewed the ${weekPeriodLabel(date)} Branch Command report for the ${branchLabel(
    branch,
  )} branch, understand its status, and have responded to every flagged item.`;
}

function safeParse<T>(json: string): T[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export { weekPeriodLabel, isoWeek };
