import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";

// Lead analytics: the geographic heat map (where leads cluster, keyed by
// neighborhood/zip and colored by funnel stage) and lead-source performance
// (which marketing channels + company-provided vs. self-generated leads convert
// best). Reads individual `SalesLead` rows; source-agnostic (manual/demo today,
// SmarterLaunch next). Everything here is read-only aggregation.

// ---- Funnel stages -----------------------------------------------------------
export const LEAD_STAGES = [
  { key: "lead", label: "Lead", color: "#d9972b" },      // amber — top of funnel
  { key: "proposal", label: "Proposal", color: "#2563c9" }, // blue — mid funnel
  { key: "closed", label: "Closed", color: "#2e6f47" },   // brand green — won
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number]["key"];
export const STAGE_COLOR: Record<string, string> = Object.fromEntries(LEAD_STAGES.map((s) => [s.key, s.color]));
export const STAGE_LABEL: Record<string, string> = Object.fromEntries(LEAD_STAGES.map((s) => [s.key, s.label]));

// ---- Lead-source (marketing) channels ---------------------------------------
export const LEAD_CHANNELS = [
  { key: "bni", label: "BNI networking", provided: false },
  { key: "referral", label: "Customer referral", provided: false },
  { key: "google", label: "Inbound Google / web", provided: true },
  { key: "web", label: "Website form", provided: true },
  { key: "other", label: "Other", provided: false },
] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number]["key"];
export const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(LEAD_CHANNELS.map((c) => [c.key, c.label]));

// ---- Date-range control ------------------------------------------------------
export type RangePreset = "this_month" | "last_month" | "ytd" | "custom";

export type DateRange = { start: Date; end: Date; preset: RangePreset; label: string; from: string; to: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Resolve the date-range control into concrete [start, end) bounds + a label. */
export function resolveRange(preset?: string | null, from?: string | null, to?: string | null, now: Date = new Date()): DateRange {
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  if (preset === "custom" && from && to) {
    const s = new Date(`${from}T00:00:00.000Z`);
    const e = new Date(`${to}T23:59:59.999Z`);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s <= e) {
      return { start: s, end: e, preset: "custom", label: `${from} → ${to}`, from, to };
    }
  }
  if (preset === "last_month") {
    const start = new Date(Date.UTC(y, mo - 1, 1));
    const end = new Date(Date.UTC(y, mo, 1) - 1);
    return { start, end, preset: "last_month", label: monthLabel(start), from: iso(start), to: iso(end) };
  }
  if (preset === "this_month") {
    const start = new Date(Date.UTC(y, mo, 1));
    return { start, end: now, preset: "this_month", label: monthLabel(start), from: iso(start), to: iso(now) };
  }
  // default: year-to-date — the board lands populated (leads, demo or real, are
  // spread across the year), and the director can narrow to a month from there.
  const start = new Date(Date.UTC(y, 0, 1));
  return { start, end: now, preset: "ytd", label: `Year to date (${y})`, from: iso(start), to: iso(now) };
}

// ---- Lead fetch --------------------------------------------------------------
// `origin` scopes the read to one data origin. When SmarterLaunch is connected the
// Sales-Team views pass origin="smarterlaunch" so they show ONLY real leads (demo
// rows stay in the table but aren't read); when it isn't, origin is left null and
// every origin (manual + demo) is read, preserving today's behavior.
export type LeadFilter = { range: DateRange; branch?: string | null; advisorEmployeeId?: string | null; origin?: string | null };

type LeadRow = {
  stage: string; channel: string; provided: boolean; value: number;
  lat: number | null; lng: number | null; zip: string | null; neighborhood: string | null; branch: string | null;
};

async function fetchLeads(f: LeadFilter): Promise<LeadRow[]> {
  return prisma.salesLead.findMany({
    where: {
      createdAt: { gte: f.range.start, lte: f.range.end },
      ...(f.branch ? { branch: f.branch } : {}),
      ...(f.advisorEmployeeId ? { advisorEmployeeId: f.advisorEmployeeId } : {}),
      ...(f.origin ? { origin: f.origin } : {}),
    },
    select: { stage: true, channel: true, provided: true, value: true, lat: true, lng: true, zip: true, neighborhood: true, branch: true },
  });
}

// ---- Geographic heat map -----------------------------------------------------
export type HeatCluster = {
  key: string;            // zip (or neighborhood) that identifies the cluster
  area: string;           // human label (neighborhood · zip)
  branch: string | null;
  lat: number; lng: number; // centroid
  total: number;
  lead: number; proposal: number; closed: number;
  value: number;          // $ attached to the cluster (all stages)
  closedValue: number;    // $ closed/won
  closeRate: number;      // closed / total
  dominant: LeadStage;    // stage with the most leads (for the dot color)
};

export type HeatMap = {
  clusters: HeatCluster[];
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
  totals: { leads: number; proposals: number; closed: number; total: number; value: number; closedValue: number; closeRate: number };
  maxDensity: number;     // largest cluster.total, for scaling the blobs
};

/** Aggregate leads into geographic clusters (by zip → neighborhood), counted by
 *  funnel stage, for the heat map. Works company-wide or for one advisor/branch. */
export async function buildHeatMap(f: LeadFilter): Promise<HeatMap> {
  const leads = await fetchLeads(f);
  const geo = leads.filter((l) => typeof l.lat === "number" && typeof l.lng === "number");

  const byKey = new Map<string, { sumLat: number; sumLng: number; n: number; area: string; branch: string | null; lead: number; proposal: number; closed: number; value: number; closedValue: number }>();
  for (const l of geo) {
    const key = l.zip || l.neighborhood || `${l.lat!.toFixed(2)},${l.lng!.toFixed(2)}`;
    let c = byKey.get(key);
    if (!c) {
      const area = [l.neighborhood, l.zip].filter(Boolean).join(" · ") || key;
      c = { sumLat: 0, sumLng: 0, n: 0, area, branch: l.branch, lead: 0, proposal: 0, closed: 0, value: 0, closedValue: 0 };
      byKey.set(key, c);
    }
    c.sumLat += l.lat!; c.sumLng += l.lng!; c.n += 1;
    c.value += l.value;
    if (l.stage === "closed") { c.closed += 1; c.closedValue += l.value; }
    else if (l.stage === "proposal") c.proposal += 1;
    else if (l.stage === "lead") c.lead += 1;
  }

  const clusters: HeatCluster[] = [...byKey.entries()].map(([key, c]) => {
    const total = c.lead + c.proposal + c.closed;
    const dominant: LeadStage = c.closed >= c.proposal && c.closed >= c.lead ? "closed" : c.proposal >= c.lead ? "proposal" : "lead";
    return {
      key, area: c.area, branch: c.branch,
      lat: c.sumLat / c.n, lng: c.sumLng / c.n,
      total, lead: c.lead, proposal: c.proposal, closed: c.closed,
      value: c.value, closedValue: c.closedValue,
      closeRate: total > 0 ? c.closed / total : 0,
      dominant,
    };
  }).sort((a, b) => b.total - a.total);

  let bounds: HeatMap["bounds"] = null;
  if (clusters.length > 0) {
    const lats = clusters.map((c) => c.lat), lngs = clusters.map((c) => c.lng);
    bounds = { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
  }

  const totals = {
    leads: clusters.reduce((s, c) => s + c.lead, 0),
    proposals: clusters.reduce((s, c) => s + c.proposal, 0),
    closed: clusters.reduce((s, c) => s + c.closed, 0),
    total: clusters.reduce((s, c) => s + c.total, 0),
    value: clusters.reduce((s, c) => s + c.value, 0),
    closedValue: clusters.reduce((s, c) => s + c.closedValue, 0),
    closeRate: 0,
  };
  totals.closeRate = totals.total > 0 ? totals.closed / totals.total : 0;
  const maxDensity = clusters.reduce((m, c) => Math.max(m, c.total), 0);

  return { clusters, bounds, totals, maxDensity };
}

// ---- Lead-source performance -------------------------------------------------
export type SourceRow = {
  key: string; label: string;
  total: number; proposals: number; closed: number;
  value: number; closedValue: number;
  closeRate: number;       // closed / total
  provided: boolean;       // is this a company-provided channel
};

export type BucketRow = {
  key: "provided" | "self";
  label: string;
  total: number; closed: number; closedValue: number; closeRate: number;
};

export type SourcePerformance = {
  sources: SourceRow[];
  buckets: BucketRow[];    // company-provided vs self-generated
  totals: { total: number; closed: number; closedValue: number; closeRate: number };
};

/** Lead-source performance: volume + conversion per marketing channel, and the
 *  company-provided vs. self-generated split. Company-wide or per advisor. */
export async function buildSourcePerformance(f: LeadFilter): Promise<SourcePerformance> {
  const leads = await fetchLeads(f);

  const byChannel = new Map<string, SourceRow>();
  for (const c of LEAD_CHANNELS) byChannel.set(c.key, { key: c.key, label: c.label, total: 0, proposals: 0, closed: 0, value: 0, closedValue: 0, closeRate: 0, provided: c.provided });

  const bucket = { provided: { total: 0, closed: 0, closedValue: 0 }, self: { total: 0, closed: 0, closedValue: 0 } };

  for (const l of leads) {
    const row = byChannel.get(l.channel) ?? byChannel.get("other")!;
    row.total += 1; row.value += l.value;
    if (l.stage === "closed") { row.closed += 1; row.closedValue += l.value; }
    else if (l.stage === "proposal") row.proposals += 1;

    const b = l.provided ? bucket.provided : bucket.self;
    b.total += 1;
    if (l.stage === "closed") { b.closed += 1; b.closedValue += l.value; }
  }

  const sources = [...byChannel.values()]
    .map((r) => ({ ...r, closeRate: r.total > 0 ? r.closed / r.total : 0 }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.closedValue - a.closedValue || b.total - a.total);

  const buckets: BucketRow[] = [
    { key: "provided", label: "Company-provided", ...bucket.provided, closeRate: bucket.provided.total > 0 ? bucket.provided.closed / bucket.provided.total : 0 },
    { key: "self", label: "Self-generated", ...bucket.self, closeRate: bucket.self.total > 0 ? bucket.self.closed / bucket.self.total : 0 },
  ];

  const total = sources.reduce((s, r) => s + r.total, 0);
  const closed = sources.reduce((s, r) => s + r.closed, 0);
  const closedValue = sources.reduce((s, r) => s + r.closedValue, 0);

  return { sources, buckets, totals: { total, closed, closedValue, closeRate: total > 0 ? closed / total : 0 } };
}

/** Compact facts string for AI grounding — heat map. */
export function heatMapFacts(h: HeatMap, scopeLabel: string): string {
  const top = h.clusters.slice(0, 6).map((c) =>
    `${c.area}${c.branch ? ` (${branchLabel(c.branch)})` : ""}: ${c.total} leads (${c.lead} lead/${c.proposal} proposal/${c.closed} closed), close ${Math.round(c.closeRate * 100)}%, $${Math.round(c.closedValue).toLocaleString("en-US")} closed`);
  return [
    `Scope: ${scopeLabel}.`,
    `Totals: ${h.totals.total} leads across ${h.clusters.length} areas; ${h.totals.leads} open leads, ${h.totals.proposals} proposals, ${h.totals.closed} closed; overall close ${Math.round(h.totals.closeRate * 100)}%.`,
    `Top areas by volume:`,
    ...top.map((t) => `- ${t}`),
  ].join("\n");
}

/** Compact facts string for AI grounding — lead sources. */
export function sourceFacts(s: SourcePerformance, scopeLabel: string): string {
  const rows = s.sources.map((r) => `- ${r.label}: ${r.total} leads, ${r.closed} closed (${Math.round(r.closeRate * 100)}%), $${Math.round(r.closedValue).toLocaleString("en-US")} closed`);
  const b = s.buckets.map((x) => `- ${x.label}: ${x.total} leads, ${x.closed} closed (${Math.round(x.closeRate * 100)}%)`);
  return [
    `Scope: ${scopeLabel}.`,
    `By channel:`, ...rows,
    `Company-provided vs self-generated:`, ...b,
  ].join("\n");
}
