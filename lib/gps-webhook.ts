import "server-only";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Shared parsing + persistence for Verizon Connect push deliveries, used by both
 * the live webhook (app/api/gps/webhook) and the backfill reprocessor.
 *
 * Verizon Connect's Integration Platform pushes CloudEvents — e.g. type
 * `com.verizonconnect.integrations.vehicle.position.updated` — where the actual
 * position lives nested under a `data` envelope (and sometimes under a further
 * `position`/`location` object). Earlier parsing only looked at the top level, so
 * these events were STORED but their lat/lng never reached GpsPosition. This
 * module digs through the envelope so pushed positions land on the map.
 */

export type Plot = {
  verizonNumber: string;
  ts: Date;
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  ignition?: boolean | null;
  address?: string | null;
  odometer?: number | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
}
function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "on", "1", "yes", "ignitionon"].includes(s)) return true;
    if (["false", "off", "0", "no", "ignitionoff"].includes(s)) return false;
  }
  return null;
}
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
/** First value under any of `keys` that is a plain object. */
function firstObject(o: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const obj = asObject(o[k]);
    if (obj) return obj;
  }
  return null;
}

// Common nested containers for the coordinate + vehicle-id fields.
const LAT_KEYS = ["latitude", "Latitude", "lat", "Lat"];
const LNG_KEYS = ["longitude", "Longitude", "lng", "Lng", "lon", "Lon", "long", "Long"];
const VN_KEYS = ["vehicleNumber", "VehicleNumber", "vehicleId", "VehicleId", "number", "Number", "vehicleName", "VehicleName", "unitNumber", "UnitNumber", "assetNumber", "id", "Id"];
const TS_KEYS = ["timestamp", "Timestamp", "eventTime", "EventTime", "gpsTime", "GpsTime", "utcTimestamp", "updateUtc", "UpdateUtc", "time", "Time", "dateTimeUtc", "occurredAt", "recordedAt", "fixTime"];

/**
 * Parse a single record into a Plot. Looks for the vehicle id + coordinates on
 * the record itself AND on nested `position`/`location`/`gps`/`coordinates`/
 * `vehicle` objects, so a CloudEvents `data` payload (flat or nested) resolves.
 */
export function parsePlot(record: Record<string, unknown>): Plot | null {
  // Vehicle id: direct, or under a nested vehicle object.
  const vehicleObj = firstObject(record, ["vehicle", "Vehicle", "asset", "Asset"]);
  const vnRaw = pick(record, VN_KEYS) ?? (vehicleObj ? pick(vehicleObj, VN_KEYS) : undefined);
  const vn = typeof vnRaw === "string" ? vnRaw : typeof vnRaw === "number" ? String(vnRaw) : null;

  // Coordinates: on the record, or nested under a location-ish object.
  const locObj = firstObject(record, ["position", "Position", "location", "Location", "gps", "Gps", "GPS", "coordinates", "Coordinates", "point", "Point", "geo", "Geo"]);
  const lat = num(pick(record, LAT_KEYS)) ?? (locObj ? num(pick(locObj, LAT_KEYS)) : null);
  const lng = num(pick(record, LNG_KEYS)) ?? (locObj ? num(pick(locObj, LNG_KEYS)) : null);

  if (!vn || lat == null || lng == null) return null;

  const scope = locObj ?? record;
  const tsRaw = pick(record, TS_KEYS) ?? (locObj ? pick(locObj, TS_KEYS) : undefined);
  const ts = tsRaw != null ? new Date(String(tsRaw)) : new Date();

  const addrRaw = pick(record, ["address", "Address", "location", "Location"]) ?? (locObj ? pick(locObj, ["address", "Address", "formattedAddress"]) : undefined);

  return {
    verizonNumber: vn,
    ts: Number.isNaN(ts.getTime()) ? new Date() : ts,
    lat,
    lng,
    speed: num(pick(scope, ["speed", "Speed", "speedMph", "speedKph", "SpeedMph"])) ?? num(pick(record, ["speed", "Speed"])),
    heading: num(pick(scope, ["heading", "Heading", "direction", "Direction", "bearing", "Bearing"])) ?? num(pick(record, ["heading", "Heading"])),
    ignition: toBool(pick(record, ["ignition", "Ignition", "ignitionOn", "IgnitionOn", "engineOn", "EngineStatus", "ignitionStatus"])),
    address: typeof addrRaw === "string" ? addrRaw : null,
    odometer: num(pick(record, ["odometer", "Odometer", "mileage", "Mileage", "odometerMiles"])),
  };
}

/**
 * Collect every plot from a payload, digging through CloudEvents envelopes and
 * batch arrays. If a node itself parses as a plot we take it and stop descending
 * that branch (avoids double-counting); otherwise we recurse into likely
 * container keys (`data`, `events`, `plots`, …) up to a small depth.
 */
export function collectPlots(json: unknown): Plot[] {
  const out: Plot[] = [];
  const CONTAINER_KEYS = ["data", "Data", "payload", "Payload", "event", "Event", "events", "Events", "plots", "Plots", "items", "Items", "records", "Records", "message", "Message", "body", "Body", "value", "Value"];

  const visit = (node: unknown, depth: number) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth);
      return;
    }
    const o = asObject(node);
    if (!o) return;
    const plot = parsePlot(o);
    if (plot) {
      out.push(plot);
      return; // this node is a plot — don't descend into it
    }
    if (depth <= 0) return;
    for (const k of CONTAINER_KEYS) {
      if (o[k] != null) visit(o[k], depth - 1);
    }
  };

  visit(json, 4);
  return out;
}

/** Persist plots as GpsPosition rows, linking to a fleet vehicle by verizonNumber. */
export async function persistPlots(db: PrismaClient, plots: Plot[]): Promise<number> {
  let saved = 0;
  const cache = new Map<string, string | null>();
  for (const p of plots) {
    let vehicleId = cache.get(p.verizonNumber);
    if (vehicleId === undefined) {
      const v = await db.vehicle.findFirst({ where: { verizonNumber: p.verizonNumber }, select: { id: true } });
      vehicleId = v?.id ?? null;
      cache.set(p.verizonNumber, vehicleId);
    }
    try {
      await db.gpsPosition.upsert({
        where: { verizonNumber_ts: { verizonNumber: p.verizonNumber, ts: p.ts } },
        update: { lat: p.lat, lng: p.lng, speed: p.speed ?? undefined, heading: p.heading ?? undefined, ignition: p.ignition ?? undefined, address: p.address ?? undefined, odometer: p.odometer ?? undefined, vehicleId: vehicleId ?? undefined, sample: false },
        create: { vehicleId: vehicleId ?? null, verizonNumber: p.verizonNumber, ts: p.ts, lat: p.lat, lng: p.lng, speed: p.speed ?? null, heading: p.heading ?? null, ignition: p.ignition ?? null, address: p.address ?? null, odometer: p.odometer ?? null, sample: false },
      });
      saved++;
    } catch {
      // Never let a single bad plot fail the batch.
    }
  }
  return saved;
}

/** Recognize a Verizon position push by CloudEvents type (used for auth + backfill). */
export function isVerizonPositionType(type: string | null | undefined): boolean {
  const t = (type ?? "").toLowerCase();
  return t.includes("verizonconnect") || t.includes("position") || t.includes("vehicle.position");
}

export type ReprocessResult = { scanned: number; parsed: number; saved: number; distinctVehicles: number };

/**
 * Backfill: re-parse already-stored webhook events into GpsPosition rows. This is
 * how the ~19.8k position events that arrived BEFORE the parser fix get onto the
 * map without waiting for new deliveries. Newest-first so current positions land
 * even if `limit` caps the run.
 */
export async function reprocessStoredPositionEvents(limit = 20000): Promise<ReprocessResult> {
  const events = await prisma.gpsWebhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: { id: true, type: true, payload: true },
  });

  const allPlots: Plot[] = [];
  let parsed = 0;
  for (const e of events) {
    // Skip obvious non-position events (e.g. SubscriptionConfirmation) unless the
    // payload still yields a plot.
    if (e.type && /subscriptionconfirmation/i.test(e.type)) continue;
    let json: unknown = null;
    try {
      json = e.payload ? JSON.parse(e.payload) : null;
    } catch {
      continue;
    }
    const plots = collectPlots(json);
    if (plots.length) {
      parsed++;
      allPlots.push(...plots);
    }
  }

  const saved = await persistPlots(prisma, allPlots);
  const distinctVehicles = new Set(allPlots.map((p) => p.verizonNumber)).size;
  return { scanned: events.length, parsed, saved, distinctVehicles };
}
