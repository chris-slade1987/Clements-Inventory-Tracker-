import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LOCATIONS } from "@/lib/weather/service";

// Weather Ops — idempotent, ADD-ONLY production healer (the project uses `db push` +
// runtime ensures instead of migrations; see lib/mbr-ensure.ts). Seeds the four
// branch forecast points if they're missing. Never clobbers admin edits (lat/lon,
// names, resolved grid data) — it only creates rows that don't exist yet. Non-fatal.

let _ran = false;

export async function ensureWeatherLoaded(): Promise<void> {
  if (_ran) return;
  try {
    const count = await prisma.weatherLocation.count();
    if (count === 0) {
      for (const l of DEFAULT_LOCATIONS) {
        await prisma.weatherLocation
          .create({ data: { branch: l.branch, name: l.name, lat: l.lat, lon: l.lon } })
          .catch(() => {}); // unique([branch,lat,lon]) race → ignore
      }
    }
    _ran = true;
  } catch (e) {
    console.error("ensureWeatherLoaded (non-fatal):", e);
  }
}
