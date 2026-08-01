import "server-only";

/**
 * Verizon Connect Reveal — server-side connector.
 *
 * Follows docs/Verizon_Connect_Reveal_API_Integration.md EXACTLY:
 *  - Two-step auth: GET /token with Basic auth → a bearer token (20-min life).
 *  - Every data call carries `Authorization: Atmosphere atmosphere_app_id=…, Bearer …`.
 *  - Base host is derived from the region: https://fim.api.${region}.fleetmatics.com
 *
 * SECURITY: credentials come from env ONLY (never hardcoded, never sent to the
 * browser). This module imports "server-only" so it can never be bundled client
 * side. The token is cached in a module-level variable — it never leaves the
 * server.
 */

const APP_ID = process.env.VERIZON_APP_ID ?? "";
const USERNAME = process.env.VERIZON_REST_USERNAME ?? "";
const PASSWORD = process.env.VERIZON_REST_PASSWORD ?? "";
const REGION = (process.env.VERIZON_REGION || "us").toLowerCase();

const BASE_HOST = `https://fim.api.${REGION}.fleetmatics.com`;

// Token is valid 20 minutes; refresh when within ~2 minutes of expiry.
const TOKEN_TTL_MS = 20 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

// Hard ceiling on any single Verizon HTTP call. Reveal's RAD endpoints can hang
// (or sit in a slow 500) for minutes, which would otherwise block whatever route
// is calling us — the diagnostics endpoint and the cron sync especially. Abort so
// a stalled upstream surfaces as a fast, typed error instead of a request hang.
const FETCH_TIMEOUT_MS = 15 * 1000;

/**
 * fetch() with a hard timeout. Aborts after `timeoutMs` and rethrows as a typed
 * VerizonError(504) so callers can treat an upstream stall like any other
 * non-2xx — never leaving a socket open long enough to hang the whole request.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  path: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new VerizonError(`Verizon ${path} timed out after ${timeoutMs}ms`, 504, path);
    }
    throw new VerizonError(
      `Verizon ${path} request failed: ${err instanceof Error ? err.message : "network error"}`,
      502,
      path,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Live mode is only possible when all three credentials are present. */
export function isConfigured(): boolean {
  return Boolean(APP_ID && USERNAME && PASSWORD);
}

export class VerizonError extends Error {
  status: number;
  path: string;
  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "VerizonError";
    this.status = status;
    this.path = path;
  }
}

// ---- Token cache (module-level, server-only) ---------------------------
let cachedToken: string | null = null;
let cachedTokenAt = 0; // epoch ms when the token was fetched

function tokenIsFresh(): boolean {
  if (!cachedToken) return false;
  return Date.now() < cachedTokenAt + TOKEN_TTL_MS - TOKEN_REFRESH_SKEW_MS;
}

/**
 * Fetch (and cache) an authorization token. Returns the cached token when it is
 * still comfortably within its 20-minute life unless `force` is set.
 */
export async function getToken(force = false): Promise<string> {
  if (!force && tokenIsFresh()) return cachedToken as string;
  if (!isConfigured()) {
    throw new VerizonError("Verizon is not configured", 0, "/token");
  }

  const basic = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
  const res = await fetchWithTimeout(
    `${BASE_HOST}/token`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
    "/token",
  );

  if (!res.ok) {
    // Never include credentials in the error.
    throw new VerizonError(`Token request failed (${res.status})`, res.status, "/token");
  }

  // Reveal returns the token as a bare JSON string (quoted) or, defensively,
  // inside an object — handle both.
  const text = (await res.text()).trim();
  let token = "";
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") token = parsed;
    else if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      token = String(o.token ?? o.access_token ?? o.Token ?? "");
    }
  } catch {
    // Not JSON — treat the raw body as the token, stripping any quotes.
    token = text.replace(/^"|"$/g, "");
  }
  if (!token) {
    throw new VerizonError("Token response had no token", 502, "/token");
  }

  cachedToken = token;
  cachedTokenAt = Date.now();
  return token;
}

/** Force the next call to re-authenticate. */
export function forceTokenRefresh(): void {
  cachedToken = null;
  cachedTokenAt = 0;
}

function atmosphereHeader(token: string): string {
  return `Atmosphere atmosphere_app_id=${APP_ID}, Bearer ${token}`;
}

/**
 * GET a data endpoint. `path` is relative to the base host (e.g.
 * "/cmd/v1/vehicles"). On a 401 the token is force-refreshed and the request is
 * retried ONCE. Throws a typed VerizonError on any non-2xx (status + path only —
 * never credentials).
 */
export async function apiGet<T = unknown>(path: string): Promise<T> {
  if (!isConfigured()) {
    throw new VerizonError("Verizon is not configured", 0, path);
  }

  const doFetch = async (token: string) =>
    fetchWithTimeout(
      `${BASE_HOST}${path}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: atmosphereHeader(token),
        },
        cache: "no-store",
      },
      path,
    );

  let token = await getToken();
  let res = await doFetch(token);

  if (res.status === 401) {
    // Token likely expired mid-flight — refresh once and retry.
    token = await getToken(true);
    res = await doFetch(token);
  }

  if (!res.ok) {
    throw new VerizonError(`Verizon GET ${path} failed (${res.status})`, res.status, path);
  }

  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new VerizonError(`Verizon GET ${path} returned non-JSON`, 502, path);
  }
}

// ---- Endpoint helpers --------------------------------------------------
// Field names in Reveal responses can vary by account; parse leniently and keep
// the raw payload so nothing is lost.

export async function listVehicles(): Promise<unknown[]> {
  const data = await apiGet<unknown>("/cmd/v1/vehicles");
  return asArray(data);
}

export async function getVehicle(vehicleNumber: string): Promise<unknown> {
  return apiGet<unknown>(`/cmd/v1/vehicles/${encodeURIComponent(vehicleNumber)}`);
}

// Fleetmatics' RAD endpoints expect datetimes as `yyyy-MM-ddTHH:mm:ss` (ISO 8601
// to SECONDS, no milliseconds, no timezone suffix). `Date.toISOString()` returns
// `…:56.789Z` — the trailing `.789Z` makes the RAD API reject the request with a
// 500. Slice to the first 19 chars to send exactly what their sample code uses
// (UTC components, matching how we already build the window in UTC).
function radDateTime(d: Date): string {
  return d.toISOString().slice(0, 19);
}

export async function statusHistory(
  vehicleNumber: string,
  opts: { start?: Date; end?: Date } = {},
): Promise<unknown[]> {
  const qs = new URLSearchParams();
  if (opts.start) qs.set("startdatetime", radDateTime(opts.start));
  if (opts.end) qs.set("enddatetime", radDateTime(opts.end));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await apiGet<unknown>(
    `/rad/v1/vehicles/${encodeURIComponent(vehicleNumber)}/status/history${suffix}`,
  );
  return asArray(data);
}

export async function segments(vehicleNumber: string, date: Date): Promise<unknown[]> {
  const day = date.toISOString().slice(0, 10);
  const data = await apiGet<unknown>(
    `/rad/v1/vehicles/${encodeURIComponent(vehicleNumber)}/segments?date=${day}`,
  );
  return asArray(data);
}

// ---- Lenient normalizers ----------------------------------------------

/** A response may be a bare array or an object wrapping one (e.g. {vehicles:[…]}). */
function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const v of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function pickNumber(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function pickBool(o: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.toLowerCase();
      if (["on", "true", "yes", "1", "ignitionon"].includes(s)) return true;
      if (["off", "false", "no", "0", "ignitionoff"].includes(s)) return false;
    }
  }
  return undefined;
}

export type VehicleIdentity = {
  number: string; // Reveal vehicle number (the id used in RAD paths)
  vin?: string;
  plate?: string;
  unitNumber?: string;
  label?: string;
  raw: unknown;
};

/** Pull identity fields out of a CMD vehicle record defensively. */
export function normalizeVehicle(raw: unknown): VehicleIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const number = pickString(o, [
    "VehicleNumber",
    "vehicleNumber",
    "number",
    "Number",
    "vehicleId",
    "VehicleId",
    "id",
  ]);
  if (!number) return null;
  return {
    number,
    vin: pickString(o, ["VIN", "Vin", "vin"]),
    plate: pickString(o, ["RegistrationNumber", "registrationNumber", "LicensePlate", "licensePlate", "plate", "Tag"]),
    unitNumber: pickString(o, ["UnitNumber", "unitNumber", "AssetNumber", "assetNumber", "unit"]),
    label: pickString(o, ["Label", "label", "Name", "name", "DisplayName", "displayName", "Description", "description"]),
    raw,
  };
}

export type NormalizedPosition = {
  ts: Date;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  address?: string;
  ignition?: boolean;
  odometer?: number;
  raw: unknown;
};

/**
 * Normalize a status/history entry into a position. Returns null only when a
 * usable timestamp + lat/lng can't be found — never throws on a missing optional
 * field.
 */
export function normalizeStatus(raw: unknown): NormalizedPosition | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  // Location may be nested under an "Address"/"Location" object.
  const loc =
    (o.Address && typeof o.Address === "object" ? (o.Address as Record<string, unknown>) : null) ??
    (o.Location && typeof o.Location === "object" ? (o.Location as Record<string, unknown>) : null) ??
    o;

  const lat = pickNumber(loc, ["Latitude", "latitude", "Lat", "lat"]);
  const lng = pickNumber(loc, ["Longitude", "longitude", "Lng", "lng", "Lon", "lon"]);
  const tsStr = pickString(o, [
    "UpdateUTC",
    "updateUtc",
    "TimestampUTC",
    "timestamp",
    "DateTime",
    "dateTime",
    "Date",
    "date",
  ]);
  const ts = tsStr ? new Date(tsStr) : null;

  if (lat == null || lng == null || !ts || Number.isNaN(ts.getTime())) return null;

  return {
    ts,
    lat,
    lng,
    speed: pickNumber(o, ["Speed", "speed", "SpeedMph", "speedMph"]),
    heading: pickNumber(o, ["Heading", "heading", "Direction", "direction", "Bearing"]),
    address: pickString(loc, ["AddressLine1", "addressLine1", "FullAddress", "fullAddress", "Address", "address"]),
    ignition: pickBool(o, ["Ignition", "ignition", "IgnitionStatus", "ignitionStatus", "EngineStatus"]),
    odometer: pickNumber(o, ["Odometer", "odometer", "OdometerMiles", "odometerMiles"]),
    raw,
  };
}

export type NormalizedSegment = {
  kind: string; // "journey" | "stop" | "other"
  startTs?: Date;
  endTs?: Date;
  distanceMi?: number;
  startAddress?: string;
  endAddress?: string;
  raw: unknown;
};

/** Normalize a segment (journey or stop) defensively. */
export function normalizeSegment(raw: unknown): NormalizedSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const typeStr = (pickString(o, ["SegmentType", "segmentType", "Type", "type", "kind"]) ?? "").toLowerCase();
  const kind = typeStr.includes("journey") || typeStr.includes("trip") || typeStr.includes("drive")
    ? "journey"
    : typeStr.includes("stop") || typeStr.includes("idle") || typeStr.includes("park")
      ? "stop"
      : "other";

  const startStr = pickString(o, ["StartDateTime", "startDateTime", "StartUTC", "start", "StartTime"]);
  const endStr = pickString(o, ["EndDateTime", "endDateTime", "EndUTC", "end", "EndTime"]);
  const start = startStr ? new Date(startStr) : null;
  const end = endStr ? new Date(endStr) : null;

  return {
    kind,
    startTs: start && !Number.isNaN(start.getTime()) ? start : undefined,
    endTs: end && !Number.isNaN(end.getTime()) ? end : undefined,
    distanceMi: pickNumber(o, ["DistanceMiles", "distanceMiles", "Distance", "distance", "Miles"]),
    startAddress: pickString(o, ["StartAddress", "startAddress", "StartLocation"]),
    endAddress: pickString(o, ["EndAddress", "endAddress", "EndLocation"]),
    raw,
  };
}
