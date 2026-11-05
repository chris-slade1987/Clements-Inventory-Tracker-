import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 20;

// Road-following geometry for a route's ordered stops, so the route map draws the
// actual streets a technician travels instead of straight lines between stops.
// Prefers Google Directions when a Maps key is configured (reachable under the cloud
// network policy, same as the Google geocoder), and falls back to the key-free OSRM
// demo, then to { line: null } so the map draws straight segments. Fetched
// server-side (no browser CORS / no client key). Best-effort — never throws.
//
// Returns { line: [[lat,lng], …] } following the roads, or { line: null }.

type Pt = [number, number]; // [lat, lng]

// Decode a Google encoded polyline (precision 5) to [lat,lng] points.
function decodePolyline(str: string): Pt[] {
  let index = 0, lat = 0, lng = 0;
  const out: Pt[] = [];
  while (index < str.length) {
    let b: number, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

async function viaGoogle(pts: Pt[], key: string): Promise<Pt[] | null> {
  // Google Directions caps waypoints per request, so walk the stops in windows of
  // up to 10 (origin + 8 intermediate + destination), overlapping the join point,
  // and concatenate each leg's decoded overview polyline.
  const WINDOW = 10;
  const line: Pt[] = [];
  try {
    for (let i = 0; i < pts.length - 1; i += WINDOW - 1) {
      const chunk = pts.slice(i, i + WINDOW);
      if (chunk.length < 2) break;
      const origin = `${chunk[0][0]},${chunk[0][1]}`;
      const destination = `${chunk[chunk.length - 1][0]},${chunk[chunk.length - 1][1]}`;
      const mid = chunk.slice(1, -1).map((p) => `${p[0]},${p[1]}`).join("|");
      const u =
        `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}` +
        (mid ? `&waypoints=${encodeURIComponent(mid)}` : "") + `&key=${key}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(u, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      if (j?.status !== "OK") return null;
      const enc = j?.routes?.[0]?.overview_polyline?.points;
      if (typeof enc !== "string") return null;
      const seg = decodePolyline(enc);
      if (line.length && seg.length) line.push(...seg.slice(1));
      else line.push(...seg);
    }
    return line.length >= 2 ? line : null;
  } catch {
    return null;
  }
}

async function viaOsrm(pts: Pt[]): Promise<Pt[] | null> {
  if (pts.length > 100) return null; // OSRM demo waypoint cap
  const path = pts.map((p) => `${p[1]},${p[0]}`).join(";"); // OSRM wants lng,lat
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "CanopyOS routing map" } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const line = coords
      .map((c: unknown) => (Array.isArray(c) && c.length >= 2 ? [Number(c[1]), Number(c[0])] as Pt : null))
      .filter((x: Pt | null): x is Pt => x !== null && Number.isFinite(x[0]) && Number.isFinite(x[1]));
    return line.length >= 2 ? line : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const raw: unknown = body?.coords;
  if (!Array.isArray(raw) || raw.length < 2) return NextResponse.json({ line: null });

  const pts = raw
    .map((c) => (Array.isArray(c) && c.length === 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])) ? [Number(c[0]), Number(c[1])] as Pt : null))
    .filter((x): x is Pt => x !== null);
  if (pts.length < 2) return NextResponse.json({ line: null });

  const key =
    process.env.GOOGLE_DIRECTIONS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;

  let line: Pt[] | null = null;
  if (key) line = await viaGoogle(pts, key);
  if (!line) line = await viaOsrm(pts);
  return NextResponse.json({ line });
}
