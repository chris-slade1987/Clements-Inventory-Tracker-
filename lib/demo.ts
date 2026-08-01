import type { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

// ---------------------------------------------------------------------------
// Demo Mode. A resettable, clearly-labeled sandbox for live leadership demos.
// Everything demo-seeded is identifiable by a stable id PREFIX (`demo_`) so the
// destructive reset can clear ONLY demo rows and never touch real data. Real
// rows use cuid ids, which never start with `demo_`, so the two sets can never
// collide. GPS sample rows (which don't carry a `demo_` id) are additionally
// tagged with the SAMPLE:demo_ verizonNumber prefix.
//
// Demo mode is ON when either the DEMO_MODE env var is "1" (deploy-level switch)
// or a `Setting` row keyed `demo_mode` has value "on" (in-app toggle). Nothing
// in here mutates real data; the only destructive path is resetDemo() in
// prisma/seed-demo.ts, which is guarded by isDemoMode().
// ---------------------------------------------------------------------------

/** Stable id prefix for every demo-seeded row. Reset clears rows by this. */
export const DEMO_ID_PREFIX = "demo_";

/** Setting key for the in-app demo toggle (value "on" | "off"). */
export const DEMO_SETTING_KEY = "demo_mode";

/** verizonNumber prefix for demo GPS sample rows (which have no demo_ id). */
export const DEMO_GPS_PREFIX = "SAMPLE:demo_";

/** Marker text stamped on free-text fields (e.g. movement reasons, notes). */
export const DEMO_MARKER = "[DEMO]";

/** Build a stable, prefixed id from parts, e.g. demoId("tech", 1) => "demo_tech_1". */
export function demoId(...parts: (string | number)[]): string {
  return DEMO_ID_PREFIX + parts.join("_");
}

/** True when an id belongs to a demo-seeded row. */
export function isDemoId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(DEMO_ID_PREFIX);
}

/** Env-only check (synchronous; no DB access). */
export function isDemoModeEnv(): boolean {
  return process.env.DEMO_MODE === "1";
}

/**
 * True when demo mode is active — DEMO_MODE=1 OR the `demo_mode` Setting is "on".
 * Reads the Setting best-effort; any DB error resolves to false (fail-safe: the
 * banner hides and the destructive reset refuses).
 */
export async function isDemoMode(client: PrismaClient = prisma): Promise<boolean> {
  if (isDemoModeEnv()) return true;
  try {
    const s = await client.setting.findUnique({ where: { key: DEMO_SETTING_KEY } });
    return (s?.value ?? "").trim().toLowerCase() === "on";
  } catch {
    return false;
  }
}

/** Flip the in-app demo toggle Setting on/off (idempotent upsert). */
export async function setDemoMode(on: boolean, client: PrismaClient = prisma): Promise<void> {
  await client.setting.upsert({
    where: { key: DEMO_SETTING_KEY },
    create: { key: DEMO_SETTING_KEY, value: on ? "on" : "off" },
    update: { value: on ? "on" : "off" },
  });
}

// Branch key -> warehouse name (matches lib/constants STANDARD_WAREHOUSES).
export const DEMO_BRANCH_WAREHOUSE: Record<string, string> = {
  vero: "Vero Beach (HQ)",
  stuart: "Stuart",
  orlando: "Orlando",
  naples: "Naples",
};

// Approx. branch office centers for placing GPS sample markers (mirrors the
// BRANCH_CENTER concept in lib/gps.ts, kept local so demo.ts stays standalone).
export const DEMO_BRANCH_CENTER: Record<string, { lat: number; lng: number }> = {
  vero: { lat: 27.6386, lng: -80.3973 },
  stuart: { lat: 27.1975, lng: -80.2528 },
  orlando: { lat: 28.5383, lng: -81.3792 },
  naples: { lat: 26.142, lng: -81.7948 },
};
