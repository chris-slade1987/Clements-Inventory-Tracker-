import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canManageAccessRights } from "@/lib/access";
import { geocodeProvider, geocodeBacklogCount, geocodeOne, geocodeBacklog } from "@/lib/geocode";

export const runtime = "nodejs";
export const maxDuration = 60;

// Routing map / geocoding diagnostics (super-admin only). Explains why stops aren't
// plotting without exposing secrets: which provider is configured, whether a live
// test geocode resolves, and how many routing stops still lack coordinates.
//
// Add ?run=1 to also FILL the backlog in this request (bounded): cached addresses
// resolve instantly, new ones via the provider (Google, concurrent). Hit it a few
// times until missingCoords hits 0 — or just let the daily cron drain it.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageAccessRights(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const run = new URL(req.url).searchParams.get("run") === "1";
  let filled: { months: number; geocoded: number } | undefined;
  if (run) filled = await geocodeBacklog(3000).catch(() => undefined);

  const prov = geocodeProvider();

  // Live test against a stable public address — proves the provider resolves at all.
  let liveTest: Record<string, unknown>;
  try {
    const hit = await geocodeOne("1600 amphitheatre parkway, mountain view, ca, 94043");
    liveTest = hit ? { ok: true, coords: `${hit.lat},${hit.lng}` } : { ok: false, note: "provider returned no result (blocked, bad/unbilled key, or unresolved)" };
  } catch (e) {
    liveTest = { ok: false, error: (e as Error).message?.slice(0, 300) || "geocode threw" };
  }

  const [missing, total] = await Promise.all([
    geocodeBacklogCount(),
    prisma.routeStop.count().catch(() => 0),
  ]);

  return NextResponse.json({
    note: "Super-admin geocode diagnostics. No secret values are returned.",
    provider: prov.provider,
    googleKeyPresent: prov.googleKey,
    liveTest,
    routeStops: { total, missingCoords: missing },
    interpretation: !prov.googleKey
      ? "No Google Geocoding key is set, and Nominatim (the only fallback) is blocked by the cloud network policy — so stops cannot geocode. Add GOOGLE_GEOCODING_API_KEY (or GOOGLE_MAPS_API_KEY) to the environment and allow maps.googleapis.com; the daily cron + 'Locate stops' then fill the backlog."
      : liveTest.ok
        ? "Google key works. The daily cron (geocodeRouting) + 'Locate stops' will clear the backlog; the cache is shared across months."
        : "A Google key is set but the live test failed — verify the key is valid, the Geocoding API is enabled, and billing is active.",
  });
}
