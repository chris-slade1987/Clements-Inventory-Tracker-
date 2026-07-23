import { prisma } from "@/lib/prisma";
import {
  isConfigured,
  listVehicles,
  statusHistory,
  segments,
  normalizeVehicle,
  normalizeStatus,
  normalizeSegment,
  type VehicleIdentity,
} from "@/lib/verizon";

// Local GPS store, sync, and query helpers for the Fleet Live Map + per-vehicle
// GPS panel. Verizon is called server-side only via lib/verizon.ts. When Verizon
// is not configured (e.g. the sandbox — the REST password lives only in Vercel),
// syncFleet() generates a small SAMPLE data set so the map + panels still demo;
// it flips to live automatically once the env vars are present.

export { isConfigured };

/** A vehicle counts as "offline" when its last ping is older than this. */
export const OFFLINE_HOURS = 6;
/** Speed (mph) at/under which a vehicle is considered not moving. */
const MOVING_SPEED_MPH = 3;

// ---- Matching -----------------------------------------------------------

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

type OurVehicle = {
  id: string;
  vin: string | null;
  plate: string | null;
  unitNumber: string | null;
  name: string;
  branch: string | null;
};

/**
 * Match a Reveal vehicle to one of ours, in priority order: VIN, plate, unit
 * number, then name/label (all normalized, case-insensitive). Returns null when
 * nothing matches.
 */
function matchVehicle(rv: VehicleIdentity, ours: OurVehicle[]): OurVehicle | null {
  const vin = norm(rv.vin);
  if (vin) {
    const m = ours.find((v) => norm(v.vin) && norm(v.vin) === vin);
    if (m) return m;
  }
  const plate = norm(rv.plate);
  if (plate) {
    const m = ours.find((v) => norm(v.plate) && norm(v.plate) === plate);
    if (m) return m;
  }
  const unit = norm(rv.unitNumber);
  if (unit) {
    const m = ours.find((v) => norm(v.unitNumber) && norm(v.unitNumber) === unit);
    if (m) return m;
  }
  const label = norm(rv.label);
  if (label) {
    const m = ours.find((v) => norm(v.name) && norm(v.name) === label);
    if (m) return m;
  }
  return null;
}

// ---- Sync ---------------------------------------------------------------

export type SyncResult = {
  ok: boolean;
  configured: boolean;
  sample: boolean;
  vehicles: number;
  positions: number;
  trips: number;
  error?: string;
};

/**
 * Sync the fleet's GPS data. Live when Verizon is configured; otherwise seeds a
 * small SAMPLE set. Never throws — errors are captured into the GpsSyncLog and
 * returned so the calling route can respond cleanly.
 */
export async function syncFleet(): Promise<SyncResult> {
  const log = await prisma.gpsSyncLog.create({ data: { startedAt: new Date() } });
  const configured = isConfigured();

  try {
    const result = configured ? await syncLive() : await syncSample();
    await prisma.gpsSyncLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        ok: true,
        vehicles: result.vehicles,
        positions: result.positions,
        trips: result.trips,
        note: configured ? "live" : "sample",
      },
    });
    return { ok: true, configured, sample: !configured, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.gpsSyncLog.update({
      where: { id: log.id },
      data: { finishedAt: new Date(), ok: false, error: message.slice(0, 500), note: configured ? "live" : "sample" },
    });
    return { ok: false, configured, sample: !configured, vehicles: 0, positions: 0, trips: 0, error: message };
  }
}

async function syncLive(): Promise<{ vehicles: number; positions: number; trips: number }> {
  const ours: OurVehicle[] = await prisma.vehicle.findMany({
    select: { id: true, vin: true, plate: true, unitNumber: true, name: true, branch: true },
  });

  const raw = await listVehicles();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3600 * 1000);

  let vehicleCount = 0;
  let positionCount = 0;
  let tripCount = 0;

  for (const r of raw) {
    const rv = normalizeVehicle(r);
    if (!rv) continue;
    vehicleCount++;

    const match = matchVehicle(rv, ours);
    if (match) {
      await prisma.vehicle.update({
        where: { id: match.id },
        data: { verizonNumber: rv.number, verizonLinkedAt: new Date() },
      });
    }
    const vehicleId = match?.id ?? null;

    // Near-real-time position(s): latest status/history entries (last ~24h).
    try {
      const history = await statusHistory(rv.number, { start: since, end: now });
      for (const h of history) {
        const pos = normalizeStatus(h);
        if (!pos) continue;
        await prisma.gpsPosition.upsert({
          where: { verizonNumber_ts: { verizonNumber: rv.number, ts: pos.ts } },
          create: {
            vehicleId,
            verizonNumber: rv.number,
            ts: pos.ts,
            lat: pos.lat,
            lng: pos.lng,
            speed: pos.speed ?? null,
            heading: pos.heading ?? null,
            address: pos.address ?? null,
            ignition: pos.ignition ?? null,
            odometer: pos.odometer ?? null,
            sample: false,
            raw: JSON.stringify(pos.raw).slice(0, 8000),
          },
          update: { vehicleId, lat: pos.lat, lng: pos.lng, speed: pos.speed ?? null, heading: pos.heading ?? null, address: pos.address ?? null, ignition: pos.ignition ?? null, odometer: pos.odometer ?? null },
        });
        positionCount++;
      }
    } catch {
      // A single vehicle's history failing must not abort the whole sync.
    }

    // Today's trips (journeys + stops).
    try {
      const segs = await segments(rv.number, now);
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      for (const s of segs) {
        const seg = normalizeSegment(s);
        if (!seg || !seg.startTs) continue;
        await prisma.gpsTrip.upsert({
          where: { verizonNumber_startTs_kind: { verizonNumber: rv.number, startTs: seg.startTs, kind: seg.kind } },
          create: {
            vehicleId,
            verizonNumber: rv.number,
            day,
            startTs: seg.startTs,
            endTs: seg.endTs ?? null,
            kind: seg.kind,
            distanceMi: seg.distanceMi ?? null,
            startAddress: seg.startAddress ?? null,
            endAddress: seg.endAddress ?? null,
            sample: false,
            raw: JSON.stringify(seg.raw).slice(0, 8000),
          },
          update: { vehicleId, endTs: seg.endTs ?? null, distanceMi: seg.distanceMi ?? null, startAddress: seg.startAddress ?? null, endAddress: seg.endAddress ?? null },
        });
        tripCount++;
      }
    } catch {
      // Ignore per-vehicle segment failures.
    }
  }

  return { vehicles: vehicleCount, positions: positionCount, trips: tripCount };
}

// ---- Sample data --------------------------------------------------------

// Branch centers (approx.) so sample markers land near the real offices.
const BRANCH_CENTER: Record<string, { lat: number; lng: number }> = {
  vero: { lat: 27.6386, lng: -80.3973 },
  stuart: { lat: 27.1975, lng: -80.2528 },
  orlando: { lat: 28.5383, lng: -81.3792 },
  naples: { lat: 26.142, lng: -81.7948 },
};

// Deterministic pseudo-random in [0,1) from a string seed, so sample points are
// stable across syncs (no drift) yet varied between vehicles.
function seeded(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const SAMPLE_POINTS = 6; // recent trail points per vehicle

/**
 * Seed a small sample set for active vehicles so the map + panels demo when
 * Verizon isn't configured. Idempotent: sample rows for a vehicle are cleared
 * and re-created each run (capped at SAMPLE_POINTS), so they never pile up.
 */
async function syncSample(): Promise<{ vehicles: number; positions: number; trips: number }> {
  const vehicles = await prisma.vehicle.findMany({
    where: { status: "active" },
    select: { id: true, branch: true, currentMileage: true },
    orderBy: { name: "asc" },
  });

  const now = Date.now();
  let vehicleCount = 0;
  let positionCount = 0;
  let tripCount = 0;

  for (const v of vehicles) {
    const verizonNumber = `SAMPLE:${v.id}`;
    const center = BRANCH_CENTER[v.branch ?? "vero"] ?? BRANCH_CENTER.vero;

    // Reset this vehicle's sample rows so we don't accumulate.
    await prisma.gpsPosition.deleteMany({ where: { verizonNumber, sample: true } });
    await prisma.gpsTrip.deleteMany({ where: { verizonNumber, sample: true } });

    // A short recent trail: SAMPLE_POINTS points, ~12 min apart, drifting around
    // the branch center. The latest point gets a varied speed/ignition state.
    const moving = seeded(v.id, 7) > 0.45;
    const odoBase = v.currentMileage ?? Math.round(40000 + seeded(v.id, 9) * 60000);

    for (let i = SAMPLE_POINTS - 1; i >= 0; i--) {
      const ts = new Date(now - i * 12 * 60 * 1000);
      const jitterLat = (seeded(v.id, i * 3 + 1) - 0.5) * 0.06;
      const jitterLng = (seeded(v.id, i * 3 + 2) - 0.5) * 0.06;
      const isLatest = i === 0;
      const speed = isLatest ? (moving ? Math.round(8 + seeded(v.id, 11) * 45) : 0) : Math.round(seeded(v.id, i * 5) * 40);
      await prisma.gpsPosition.create({
        data: {
          vehicleId: v.id,
          verizonNumber,
          ts,
          lat: center.lat + jitterLat,
          lng: center.lng + jitterLng,
          speed,
          heading: Math.round(seeded(v.id, i * 7) * 360),
          address: `${v.branch ? cap(v.branch) : "Vero Beach"}, FL (sample)`,
          ignition: isLatest ? moving : speed > 0,
          odometer: odoBase + (SAMPLE_POINTS - i) * 2,
          sample: true,
        },
      });
      positionCount++;
    }
    vehicleCount++;

    // One sample journey + one stop for today.
    const day = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const jStart = new Date(now - 5 * 3600 * 1000);
    const jEnd = new Date(now - 4 * 3600 * 1000);
    const sStart = new Date(now - 4 * 3600 * 1000);
    const sEnd = new Date(now - 3.5 * 3600 * 1000);
    await prisma.gpsTrip.create({
      data: { vehicleId: v.id, verizonNumber, day, startTs: jStart, endTs: jEnd, kind: "journey", distanceMi: Math.round(seeded(v.id, 21) * 30 + 5), startAddress: "Branch office (sample)", endAddress: "Service route (sample)", sample: true },
    });
    await prisma.gpsTrip.create({
      data: { vehicleId: v.id, verizonNumber, day, startTs: sStart, endTs: sEnd, kind: "stop", distanceMi: 0, startAddress: "Customer site (sample)", sample: true },
    });
    tripCount += 2;
  }

  return { vehicles: vehicleCount, positions: positionCount, trips: tripCount };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Queries ------------------------------------------------------------

export type LivePosition = {
  vehicleId: string;
  verizonNumber: string;
  unitNumber: string | null;
  name: string;
  branch: string | null;
  ts: Date;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  address: string | null;
  ignition: boolean | null;
  odometer: number | null;
  sample: boolean;
  status: "moving" | "idle" | "stopped" | "offline";
};

function classify(ts: Date, speed: number | null, ignition: boolean | null): LivePosition["status"] {
  if (Date.now() - ts.getTime() > OFFLINE_HOURS * 3600 * 1000) return "offline";
  if ((speed ?? 0) > MOVING_SPEED_MPH) return "moving";
  if (ignition === true) return "idle";
  return "stopped";
}

/** The most recent position per linked vehicle (optionally scoped to a branch). */
export async function latestPositions(branch?: string): Promise<LivePosition[]> {
  const positions = await prisma.gpsPosition.findMany({
    where: {
      vehicleId: { not: null },
      ...(branch ? { vehicle: { branch } } : {}),
    },
    orderBy: { ts: "desc" },
    include: { vehicle: { select: { id: true, unitNumber: true, name: true, branch: true } } },
  });

  const byVehicle = new Map<string, LivePosition>();
  for (const p of positions) {
    if (!p.vehicle) continue;
    if (byVehicle.has(p.vehicle.id)) continue; // first = most recent (desc order)
    byVehicle.set(p.vehicle.id, {
      vehicleId: p.vehicle.id,
      verizonNumber: p.verizonNumber,
      unitNumber: p.vehicle.unitNumber,
      name: p.vehicle.name,
      branch: p.vehicle.branch,
      ts: p.ts,
      lat: p.lat,
      lng: p.lng,
      speed: p.speed,
      heading: p.heading,
      address: p.address,
      ignition: p.ignition,
      odometer: p.odometer,
      sample: p.sample,
      status: classify(p.ts, p.speed, p.ignition),
    });
  }
  return [...byVehicle.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export type TrailPoint = { ts: Date; lat: number; lng: number; speed: number | null; ignition: boolean | null; address: string | null; odometer: number | null; sample: boolean };

/** All positions for one vehicle within the last `sinceHours` (oldest → newest). */
export async function positionsFor(vehicleId: string, sinceHours = 24): Promise<TrailPoint[]> {
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const rows = await prisma.gpsPosition.findMany({
    where: { vehicleId, ts: { gte: since } },
    orderBy: { ts: "asc" },
    select: { ts: true, lat: true, lng: true, speed: true, ignition: true, address: true, odometer: true, sample: true },
  });
  return rows;
}

export type TripRow = { id: string; kind: string; startTs: Date | null; endTs: Date | null; distanceMi: number | null; startAddress: string | null; endAddress: string | null; sample: boolean };

/** Trips for one vehicle on a given day (defaults to today). */
export async function tripsFor(vehicleId: string, day = new Date()): Promise<TripRow[]> {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const rows = await prisma.gpsTrip.findMany({
    where: { vehicleId, startTs: { gte: start, lt: end } },
    orderBy: { startTs: "asc" },
    select: { id: true, kind: true, startTs: true, endTs: true, distanceMi: true, startAddress: true, endAddress: true, sample: true },
  });
  return rows;
}

export type FleetLiveSummary = {
  configured: boolean;
  sample: boolean;
  moving: number;
  idle: number;
  stopped: number;
  offline: number;
  linked: number;
  lastSyncAt: Date | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
};

/** Rollup for the Live Map header: status counts + last sync info. */
export async function fleetLiveSummary(branch?: string): Promise<FleetLiveSummary> {
  const positions = await latestPositions(branch);
  const lastSync = await prisma.gpsSyncLog.findFirst({ orderBy: { startedAt: "desc" } });

  const counts = { moving: 0, idle: 0, stopped: 0, offline: 0 };
  for (const p of positions) counts[p.status]++;

  return {
    configured: isConfigured(),
    sample: positions.some((p) => p.sample) || (!isConfigured() && positions.length > 0),
    moving: counts.moving,
    idle: counts.idle,
    stopped: counts.stopped,
    offline: counts.offline,
    linked: positions.length,
    lastSyncAt: lastSync?.finishedAt ?? lastSync?.startedAt ?? null,
    lastSyncOk: lastSync ? lastSync.ok : null,
    lastSyncError: lastSync?.error ?? null,
  };
}
