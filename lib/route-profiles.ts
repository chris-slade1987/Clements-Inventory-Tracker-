import "server-only";
import { prisma } from "@/lib/prisma";

// Per-route knowledge the routing review + AI rely on. DEFAULTS below encode what
// we already know (confirmed by Chris); the RouteProfile table holds edits +
// confirmations that accrue over time (confirm-once, self-correcting). The
// resolver layers DB rows over defaults. See docs/ROUTING-APPROVAL.md.
//
// kind:
//   "route"      — standard residential route, graded on stops/day efficiency.
//   "commercial" — big accounts, fewer stops, higher $; NOT graded on stops/day.
//   "senior"     — senior personnel / managers; their schedule is reviewed so
//                  nothing is missed, but never graded on route efficiency.
//   "exclude"    — not a real route (ignore in the review).

export type RouteKind = "route" | "commercial" | "senior" | "exclude";

export type RouteProfileDef = {
  routeNumber: string;
  canonicalName: string;
  branch?: "vero" | "stuart" | "orlando" | "naples";
  kind: RouteKind;
  partnerRouteNumbers?: string[]; // paired crews with overlapping jobs
  aliases?: string[]; // other names that report under this route number
  note?: string;
};

// Seeded from Chris's answers (2026-10-24):
//  • Route 17 is BRIAN; NATHAN's stray stop belongs to route 17 (same number, so
//    it merges automatically — alias recorded for clarity).
//  • TIM/JASON#20/TED/ADAM/COREY/SENTR are senior personnel / managers — include
//    their schedules (so nothing is missed) but don't grade route efficiency.
//  • GUS (19) and JACOB (16) are a paired commercial crew with overlapping jobs.
export const DEFAULT_ROUTE_PROFILES: RouteProfileDef[] = [
  { routeNumber: "17", canonicalName: "BRIAN", branch: "vero", kind: "route", aliases: ["NATHAN"] },
  { routeNumber: "19", canonicalName: "GUS", branch: "vero", kind: "commercial", partnerRouteNumbers: ["16"] },
  { routeNumber: "16", canonicalName: "JACOB", branch: "vero", kind: "commercial", partnerRouteNumbers: ["19"] },
  { routeNumber: "22", canonicalName: "TIM", branch: "vero", kind: "senior" },
  { routeNumber: "20", canonicalName: "JASON", branch: "vero", kind: "senior" },
  { routeNumber: "302", canonicalName: "TED", branch: "orlando", kind: "senior" },
  { routeNumber: "201", canonicalName: "ADAM", branch: "stuart", kind: "senior" },
  { routeNumber: "404", canonicalName: "COREY", branch: "naples", kind: "senior" },
  { routeNumber: "47", canonicalName: "SENTR", branch: "vero", kind: "senior", note: "Reads like a Sentricon service route — confirm whether person or service." },
];

export function normalizeRouteNumber(n: string): string {
  return (n || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "") || (n || "").trim();
}

export type EffectiveProfile = RouteProfileDef & { confirmed: boolean; canopyEmployeeId: string | null };

/** Build the effective route-number → profile map: code defaults with any DB
 *  RouteProfile rows layered on top (DB wins per field when set). */
export async function resolveRouteProfiles(): Promise<Map<string, EffectiveProfile>> {
  const map = new Map<string, EffectiveProfile>();
  for (const d of DEFAULT_ROUTE_PROFILES) {
    map.set(normalizeRouteNumber(d.routeNumber), { ...d, confirmed: false, canopyEmployeeId: null });
  }
  const rows = await prisma.routeProfile.findMany().catch(() => []);
  for (const r of rows) {
    const key = normalizeRouteNumber(r.routeNumber);
    const base = map.get(key);
    const partners = safeArr(r.partnerRouteNumbers);
    const aliases = safeArr(r.aliases);
    map.set(key, {
      routeNumber: r.routeNumber,
      canonicalName: r.canonicalName ?? base?.canonicalName ?? r.routeNumber,
      branch: (r.branch as EffectiveProfile["branch"]) ?? base?.branch,
      kind: (r.kind as RouteKind) || base?.kind || "route",
      partnerRouteNumbers: partners.length ? partners : base?.partnerRouteNumbers,
      aliases: aliases.length ? aliases : base?.aliases,
      note: r.note ?? base?.note,
      confirmed: r.confirmed,
      canopyEmployeeId: r.canopyEmployeeId ?? null,
    });
  }
  return map;
}

/** The profile for one route number (defaults if no DB row), with a sane fallback
 *  so an unknown route is still a gradable "route". */
export function profileFor(
  map: Map<string, EffectiveProfile>,
  routeNumber: string,
  fallbackName?: string,
): EffectiveProfile {
  const key = normalizeRouteNumber(routeNumber);
  return (
    map.get(key) ?? {
      routeNumber,
      canonicalName: fallbackName || routeNumber,
      kind: "route",
      confirmed: false,
      canopyEmployeeId: null,
    }
  );
}

function safeArr(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
