import "server-only";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import type { BriefingContent, DayPoint, Flag, GridData, HourPoint, RiskLevel, WxAlert } from "./types";
import { grade, resolveThresholds, inBlackout } from "./rules";
import * as nws from "./nws";
import { generateBriefing } from "./briefing";

// Weather Ops — orchestration: refresh-on-read (60-min staleness + a lock so
// concurrent requests don't double-fetch), snapshot persistence, the stale-fallback
// (never an empty tile), territory assembly with worst-risk rollup, AI-briefing
// regeneration only when the risk/flags change, and 30-day snapshot retention.
// All branch scoping is enforced by the API layer; this module is scope-agnostic.
// See docs/WEATHER-OPS.md.

const STALE_MS = 60 * 60 * 1000; // 60 minutes
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Seed points — approximate branch-area centers (admin-editable afterwards). Grid
// data is resolved lazily on first fetch and cached on the row.
export const DEFAULT_LOCATIONS: { branch: string; name: string; lat: number; lon: number }[] = [
  { branch: "vero", name: "Vero Beach (branch area)", lat: 27.6386, lon: -80.3973 },
  { branch: "stuart", name: "Stuart (branch area)", lat: 27.1975, lon: -80.2528 },
  { branch: "orlando", name: "Orlando (branch area)", lat: 28.5384, lon: -81.3789 },
  { branch: "naples", name: "Naples (branch area)", lat: 26.142, lon: -81.7948 },
];

/** "YYYY-MM-DD" for today in Eastern time (the ops day). */
export function todayET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}
function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
const RISK_RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };
export function worseRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

// ---- Config reads ----------------------------------------------------------

export async function getThresholds() {
  const row = await prisma.weatherSettings.findUnique({ where: { id: "singleton" } }).catch(() => null);
  return resolveThresholds(parseJson(row?.thresholds, null));
}

export async function getBlackouts(branch?: string) {
  return prisma.fertBlackout
    .findMany({ where: branch ? { branch } : {}, orderBy: { startMonthDay: "asc" } })
    .catch(() => []);
}

async function blackoutActiveToday(branch: string, date: string): Promise<boolean> {
  const monthDay = date.slice(5); // "MM-DD"
  const rows = await getBlackouts(branch);
  return rows.some((r) => inBlackout(monthDay, r.startMonthDay, r.endMonthDay));
}

// ---- Fetch + persist with a per-location lock ------------------------------

const inflight = new Map<string, Promise<SnapshotView>>();

type LocationRow = {
  id: string; branch: string; name: string; lat: number; lon: number;
  gridId: string | null; gridX: number | null; gridY: number | null; radarStation: string | null;
  forecastUrl: string | null; forecastHourlyUrl: string | null; forecastGridDataUrl: string | null;
};

export type SnapshotView = {
  locationId: string;
  fetchedAt: string;
  hourly: HourPoint[];
  daily: DayPoint[];
  grid: GridData;
  alerts: WxAlert[];
  flags: Flag[];
  riskLevel: RiskLevel;
  isStale: boolean;
};

function snapshotToView(s: {
  locationId: string; fetchedAt: Date; hourly: string | null; daily: string | null; grid: string | null;
  alerts: string | null; flags: string | null; riskLevel: string; isStale: boolean;
}): SnapshotView {
  return {
    locationId: s.locationId,
    fetchedAt: s.fetchedAt.toISOString(),
    hourly: parseJson<HourPoint[]>(s.hourly, []),
    daily: parseJson<DayPoint[]>(s.daily, []),
    grid: parseJson<GridData>(s.grid, { qpf24In: null, maxGustMph: null, maxHeatIndexF: null, thunderLikely: false }),
    alerts: parseJson<WxAlert[]>(s.alerts, []),
    flags: parseJson<Flag[]>(s.flags, []),
    riskLevel: (s.riskLevel as RiskLevel) ?? "green",
    isStale: s.isStale,
  };
}

/** Fetch fresh data for one location, compute flags/risk, persist a snapshot. */
async function doRefresh(loc: LocationRow): Promise<SnapshotView> {
  // Resolve + cache the NWS grid/URLs once (they never change for a lat/lon).
  let hourlyUrl = loc.forecastHourlyUrl;
  let dailyUrl = loc.forecastUrl;
  let gridUrl = loc.forecastGridDataUrl;
  if (!hourlyUrl || !dailyUrl || !gridUrl) {
    const p = await nws.resolvePoint(loc.lat, loc.lon);
    hourlyUrl = p.forecastHourlyUrl; dailyUrl = p.forecastUrl; gridUrl = p.forecastGridDataUrl;
    await prisma.weatherLocation.update({
      where: { id: loc.id },
      data: {
        gridId: p.gridId, gridX: p.gridX, gridY: p.gridY, radarStation: p.radarStation,
        forecastUrl: p.forecastUrl, forecastHourlyUrl: p.forecastHourlyUrl, forecastGridDataUrl: p.forecastGridDataUrl,
      },
    }).catch(() => {});
    // Reflect the resolved grid on the in-memory row too, so the SAME request that
    // first resolves a point already renders the radar station (not just the next one).
    loc.gridId = p.gridId; loc.gridX = p.gridX; loc.gridY = p.gridY; loc.radarStation = p.radarStation;
    loc.forecastUrl = p.forecastUrl; loc.forecastHourlyUrl = p.forecastHourlyUrl; loc.forecastGridDataUrl = p.forecastGridDataUrl;
  }

  const [hourly, daily, gridData, alerts, tropicalActive, thresholds] = await Promise.all([
    nws.fetchHourly(hourlyUrl),
    nws.fetchDaily(dailyUrl),
    nws.fetchGrid(gridUrl),
    nws.fetchAlerts(loc.lat, loc.lon),
    nws.fetchTropicalActive(),
    getThresholds(),
  ]);

  const date = todayET();
  const blackout = await blackoutActiveToday(loc.branch, date);
  const { flags, risk } = grade({ hourly, grid: gridData, alerts, tropicalActive, date, blackout }, thresholds);

  const created = await prisma.weatherSnapshot.create({
    data: {
      locationId: loc.id,
      hourly: JSON.stringify(hourly),
      daily: JSON.stringify(daily),
      grid: JSON.stringify(gridData),
      alerts: JSON.stringify(alerts),
      flags: JSON.stringify(flags),
      riskLevel: risk,
      isStale: false,
    },
  });
  return snapshotToView(created);
}

async function latestSnapshot(locationId: string): Promise<SnapshotView | null> {
  const s = await prisma.weatherSnapshot
    .findFirst({ where: { locationId }, orderBy: { fetchedAt: "desc" } })
    .catch(() => null);
  return s ? snapshotToView(s) : null;
}

/**
 * Serve the freshest snapshot for a location, refreshing on read when the newest is
 * older than 60 min. A lock dedupes concurrent refreshes. On fetch failure, return
 * the last good snapshot marked stale (never nothing). `force` bypasses the age check.
 */
export async function getLocationSnapshot(loc: LocationRow, force = false): Promise<SnapshotView | null> {
  const latest = await latestSnapshot(loc.id);
  const fresh = latest && !force && Date.now() - new Date(latest.fetchedAt).getTime() < STALE_MS;
  if (fresh) return latest;

  if (inflight.has(loc.id)) return inflight.get(loc.id)!;
  const p = doRefresh(loc)
    .catch((e) => {
      console.error(`weather refresh failed for ${loc.branch}/${loc.name} (non-fatal):`, e);
      if (latest) return { ...latest, isStale: true };
      throw e;
    })
    .finally(() => inflight.delete(loc.id));
  inflight.set(loc.id, p as Promise<SnapshotView>);
  try {
    return await p;
  } catch {
    return latest ? { ...latest, isStale: true } : null;
  }
}

// ---- Territory assembly (worst-risk rollup + briefing) ---------------------

export type TerritoryView = {
  branch: string;
  label: string;
  risk: RiskLevel;
  flags: Flag[];
  current: { tempF: number | null; short: string; windMph: number | null; pop: number | null; humidity: number | null } | null;
  hourly: HourPoint[];
  daily: DayPoint[];
  alerts: WxAlert[];
  briefing: BriefingContent | null;
  briefingModel: string | null;
  updatedAt: string | null;
  stale: boolean;
  locations: { id: string; name: string; lat: number; lon: number; risk: RiskLevel; radarStation: string | null }[];
};

function currentConditions(hourly: HourPoint[], date: string): TerritoryView["current"] {
  if (hourly.length === 0) return null;
  const now = Date.now();
  const upcoming = hourly.find((h) => new Date(h.time).getTime() >= now - 30 * 60 * 1000) ?? hourly[0];
  void date;
  return { tempF: upcoming.tempF, short: upcoming.short, windMph: upcoming.windMph, pop: upcoming.pop, humidity: upcoming.humidity };
}

/** Dedup flags across a territory's points, keeping the worst level per code. */
function mergeFlags(all: Flag[]): Flag[] {
  const order = { info: 0, yellow: 1, red: 2 } as const;
  const byCode = new Map<string, Flag>();
  for (const f of all) {
    const prev = byCode.get(f.code);
    if (!prev) { byCode.set(f.code, f); continue; }
    const merged: Flag = order[f.level] > order[prev.level] ? f : prev;
    const hours = Array.from(new Set([...(prev.hours ?? []), ...(f.hours ?? [])])).sort();
    byCode.set(f.code, hours.length ? { ...merged, hours } : merged);
  }
  return [...byCode.values()];
}

// Cost guardrail: at most ONE AI briefing per territory per hour, no matter how much
// the weather churns. The deterministic risk/flags (the badge) always stay current —
// only the AI prose is rate-limited. Exception: an escalation INTO a red day always
// regenerates immediately (red is rare + safety-critical), so a dangerous day never
// shows a stale "all clear" headline. Keeps Anthropic spend bounded + predictable.
const MIN_BRIEFING_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Regenerate the AI briefing only when the risk/flag set changes AND the last briefing
 * is at least an hour old (the cost cap) — or on an escalation to red. Otherwise reuse.
 */
async function resolveBriefing(
  branch: string, date: string, risk: RiskLevel, flags: Flag[], hourly: HourPoint[], daily: DayPoint[], alerts: WxAlert[]
): Promise<{ content: BriefingContent | null; model: string | null }> {
  const flagKey = flags.map((f) => f.code).sort().join(",");
  const latest = await prisma.weatherBriefing
    .findFirst({ where: { branch, forDate: date }, orderBy: { generatedAt: "desc" } })
    .catch(() => null);
  if (latest) {
    const reuse = () => ({ content: parseJson<BriefingContent | null>(latest.content, null), model: latest.model });
    const sameState = latest.riskLevel === risk && parseJson<string[]>(latest.flags, []).join(",") === flagKey;
    const ageMs = Date.now() - latest.generatedAt.getTime();
    const escalatedToRed = risk === "red" && latest.riskLevel !== "red";
    // Unchanged → reuse. Changed but within the hourly cap (and not a red escalation) → reuse.
    if (sameState || (ageMs < MIN_BRIEFING_INTERVAL_MS && !escalatedToRed)) return reuse();
  }
  const { content, model } = await generateBriefing({ territory: branchLabel(branch), date, risk, flags, hourly, daily, alerts });
  await prisma.weatherBriefing
    .create({ data: { branch, forDate: date, riskLevel: risk, flags: JSON.stringify(flags.map((f) => f.code)), content: JSON.stringify(content), model } })
    .catch((e) => console.error("weather briefing persist (non-fatal):", e));
  return { content, model };
}

/** Assemble a territory view (worst risk across its points + the AI briefing). */
export async function getTerritory(branch: string, opts: { force?: boolean; withBriefing?: boolean } = {}): Promise<TerritoryView> {
  const label = branchLabel(branch);
  const locs = (await prisma.weatherLocation
    .findMany({ where: { branch, active: true }, orderBy: { createdAt: "asc" } })
    .catch(() => [])) as LocationRow[];

  const date = todayET();
  const snaps: { loc: LocationRow; snap: SnapshotView | null }[] = [];
  for (const loc of locs) snaps.push({ loc, snap: await getLocationSnapshot(loc, opts.force) });

  const withData = snaps.filter((s) => s.snap);
  if (withData.length === 0) {
    return { branch, label, risk: "green", flags: [], current: null, hourly: [], daily: [], alerts: [], briefing: null, briefingModel: null, updatedAt: null, stale: true, locations: locs.map((l) => ({ id: l.id, name: l.name, lat: l.lat, lon: l.lon, risk: "green", radarStation: l.radarStation })) };
  }

  const risk = withData.reduce<RiskLevel>((acc, s) => worseRisk(acc, s.snap!.riskLevel), "green");
  const flags = mergeFlags(withData.flatMap((s) => s.snap!.flags));
  const alerts = dedupeAlerts(withData.flatMap((s) => s.snap!.alerts));
  // Representative point for the hourly/daily display = the worst-risk location.
  const rep = [...withData].sort((a, b) => RISK_RANK[b.snap!.riskLevel] - RISK_RANK[a.snap!.riskLevel])[0];
  const stale = withData.some((s) => s.snap!.isStale);
  const updatedAt = withData.map((s) => s.snap!.fetchedAt).sort().slice(-1)[0] ?? null;

  let briefing: BriefingContent | null = null;
  let briefingModel: string | null = null;
  if (opts.withBriefing !== false) {
    const b = await resolveBriefing(branch, date, risk, flags, rep.snap!.hourly, rep.snap!.daily, alerts);
    briefing = b.content; briefingModel = b.model;
  }

  return {
    branch, label, risk, flags,
    current: currentConditions(rep.snap!.hourly, date),
    hourly: rep.snap!.hourly,
    daily: rep.snap!.daily,
    alerts,
    briefing, briefingModel,
    updatedAt, stale,
    locations: snaps.map((s) => ({ id: s.loc.id, name: s.loc.name, lat: s.loc.lat, lon: s.loc.lon, risk: s.snap?.riskLevel ?? "green", radarStation: s.loc.radarStation })),
  };
}

function dedupeAlerts(all: WxAlert[]): WxAlert[] {
  const seen = new Set<string>();
  const out: WxAlert[] = [];
  for (const a of all) {
    const k = `${a.event}|${a.headline}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(a);
  }
  return out;
}

/** All four territories (admin view). Light option skips the AI briefing per card. */
export async function getAllTerritories(opts: { force?: boolean; withBriefing?: boolean } = {}): Promise<TerritoryView[]> {
  return Promise.all(BRANCHES.map((b) => getTerritory(b.key, opts)));
}

// ---- Cron / maintenance ----------------------------------------------------

/** Refresh every active location (used by the hourly cron + morning run). */
export async function refreshAll(): Promise<{ refreshed: number; failed: number; territories: { branch: string; risk: RiskLevel }[] }> {
  const locs = (await prisma.weatherLocation.findMany({ where: { active: true } }).catch(() => [])) as LocationRow[];
  let refreshed = 0, failed = 0;
  for (const loc of locs) {
    const s = await getLocationSnapshot(loc, true);
    if (s && !s.isStale) refreshed++; else failed++;
  }
  // Regenerate briefings against the fresh data (morning run / change detection).
  const territories = await Promise.all(BRANCHES.map((b) => getTerritory(b.key, { withBriefing: true })));
  await purgeOldSnapshots();
  return { refreshed, failed, territories: territories.map((t) => ({ branch: t.branch, risk: t.risk })) };
}

/** Delete snapshots older than 30 days (briefings are kept forever). */
export async function purgeOldSnapshots(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const r = await prisma.weatherSnapshot.deleteMany({ where: { fetchedAt: { lt: cutoff } } }).catch(() => ({ count: 0 }));
  return r.count;
}

/**
 * Geocoded scheduled stops for a branch on a given ET day, pulled from Canopy's own
 * routing data (the Route* tables populated by Routing Approval) — NOT an external
 * feed. Lets the radar show job density against the rain window. Empty until routing
 * for the day is loaded + geocoded. Capped so the map stays light.
 */
export async function getScheduledStops(branch: string, date: string = todayET()): Promise<{ lat: number; lng: number }[]> {
  const months = await prisma.routingMonth.findMany({ where: { branch }, select: { id: true } }).catch(() => []);
  if (months.length === 0) return [];
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(Date.UTC(y, m - 1, d + 1));
  const stops = await prisma.routeStop
    .findMany({
      where: { routingMonthId: { in: months.map((x) => x.id) }, date: { gte: start, lt: end }, lat: { not: null }, lng: { not: null } },
      select: { lat: true, lng: true },
      take: 600,
    })
    .catch(() => []);
  return stops.flatMap((s) => (s.lat != null && s.lng != null ? [{ lat: s.lat, lng: s.lng }] : []));
}

/** Diagnostics support: last fetch + status per location. */
export async function diagnosticsSnapshot() {
  const locs = (await prisma.weatherLocation.findMany({ orderBy: { branch: "asc" } }).catch(() => [])) as (LocationRow & { active: boolean })[];
  const rows = [];
  for (const loc of locs) {
    const latest = await latestSnapshot(loc.id);
    rows.push({
      branch: loc.branch, name: loc.name, active: loc.active,
      gridResolved: !!loc.gridId, radarStation: loc.radarStation,
      lastFetch: latest?.fetchedAt ?? null,
      lastRisk: latest?.riskLevel ?? null,
      stale: latest ? Date.now() - new Date(latest.fetchedAt).getTime() >= STALE_MS : true,
      flags: latest?.flags.map((f) => f.code) ?? [],
    });
  }
  return rows;
}
