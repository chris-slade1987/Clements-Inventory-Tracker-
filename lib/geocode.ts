import "server-only";
import { prisma } from "@/lib/prisma";

// Address → lat/lng, cached once in GeocodeCache and shared across months/branches.
// Provider-agnostic: Google Geocoding when a key is set (best for the cloud env's
// network policy), else OpenStreetMap Nominatim. Never throws — a miss leaves the
// stop without coordinates and the map falls back to a deterministic layout, so
// ingestion never fails on geocoding. See docs/ROUTING-APPROVAL.md.

export type LatLng = { lat: number; lng: number };

export function normalizeAddress(address: string, city: string, state: string, zip: string): string {
  return [address, city, state, zip].map((s) => (s || "").trim()).filter(Boolean).join(", ").replace(/\s+/g, " ").toLowerCase();
}

function geocodeConfigured(): "google" | "nominatim" {
  return process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY ? "google" : "nominatim";
}

async function fetchGoogle(q: string): Promise<LatLng | null> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const u = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=us&key=${key}`;
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    const loc = j?.results?.[0]?.geometry?.location;
    return loc && Number.isFinite(loc.lat) ? { lat: loc.lat, lng: loc.lng } : null;
  } catch {
    return null;
  }
}

async function fetchNominatim(q: string): Promise<LatLng | null> {
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
    const r = await fetch(u, { headers: { "User-Agent": "CanopyOS/1.0 (routing-approval)" } });
    if (!r.ok) return null;
    const j = await r.json();
    const hit = j?.[0];
    return hit && Number.isFinite(+hit.lat) ? { lat: +hit.lat, lng: +hit.lon } : null;
  } catch {
    return null;
  }
}

/** Geocode one normalized query, using the cache first. Writes successful lookups
 *  back to the cache. Returns null on any miss/failure (non-fatal). */
export async function geocodeOne(query: string): Promise<LatLng | null> {
  const q = query.trim();
  if (!q) return null;
  const cached = await prisma.geocodeCache.findUnique({ where: { query: q } }).catch(() => null);
  if (cached) return { lat: cached.lat, lng: cached.lng };
  const provider = geocodeConfigured();
  const hit = provider === "google" ? await fetchGoogle(q) : await fetchNominatim(q);
  if (hit) {
    await prisma.geocodeCache.create({ data: { query: q, lat: hit.lat, lng: hit.lng, source: provider } }).catch(() => {});
  }
  return hit;
}

/** Geocode a set of unique normalized queries, cache-first, politely rate-limited
 *  for Nominatim. Returns a map of query → LatLng for the ones that resolved.
 *  Bounded so a huge upload can't stall ingest — the rest stay uncoordinated and
 *  fall back to the deterministic layout, then fill in on a later pass. */
export async function geocodeMany(queries: string[], opts?: { max?: number }): Promise<Map<string, LatLng>> {
  const out = new Map<string, LatLng>();
  const uniq = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  // Pull everything already cached in one query.
  const cached = await prisma.geocodeCache.findMany({ where: { query: { in: uniq } } }).catch(() => []);
  for (const c of cached) out.set(c.query, { lat: c.lat, lng: c.lng });
  const missing = uniq.filter((q) => !out.has(q));
  const provider = geocodeConfigured();
  const cap = opts?.max ?? (provider === "google" ? 2000 : 120); // bound external calls per ingest
  const toFetch = missing.slice(0, cap);
  for (const q of toFetch) {
    const hit = provider === "google" ? await fetchGoogle(q) : await fetchNominatim(q);
    if (hit) {
      out.set(q, hit);
      await prisma.geocodeCache.create({ data: { query: q, lat: hit.lat, lng: hit.lng, source: provider } }).catch(() => {});
    }
    if (provider === "nominatim") await new Promise((r) => setTimeout(r, 1100));
  }
  return out;
}

/** Fill missing coordinates for a routing month's stops, bounded per call so it
 *  can run on demand (page load / a job) without stalling. Returns how many stops
 *  were updated. Non-fatal. */
export async function geocodeRoutingMonth(routingMonthId: string, cap = 60): Promise<number> {
  const stops = await prisma.routeStop
    .findMany({ where: { routingMonthId, lat: null }, select: { id: true, address: true, city: true, zip: true } })
    .catch(() => []);
  if (!stops.length) return 0;
  const byQuery = new Map<string, string[]>();
  for (const s of stops) {
    const q = normalizeAddress(s.address || "", s.city || "", "FL", s.zip || "");
    if (!q) continue;
    if (!byQuery.has(q)) byQuery.set(q, []);
    byQuery.get(q)!.push(s.id);
  }
  const geo = await geocodeMany([...byQuery.keys()], { max: cap });
  let n = 0;
  for (const [q, ids] of byQuery) {
    const g = geo.get(q);
    if (g) {
      await prisma.routeStop.updateMany({ where: { id: { in: ids } }, data: { lat: g.lat, lng: g.lng } }).catch(() => {});
      n += ids.length;
    }
  }
  return n;
}
