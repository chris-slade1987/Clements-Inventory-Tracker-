import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { DEFAULT_THRESHOLDS } from "@/lib/weather/rules";
import type { Thresholds } from "@/lib/weather/types";
import { getThresholds, getBlackouts } from "@/lib/weather/service";

export const runtime = "nodejs";

const VALID = new Set<string>(BRANCHES.map((b) => b.key));
const THRESHOLD_KEYS = Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[];
const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };

async function requireAdminUser() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

// Admin-only. GET returns the current thresholds, forecast locations, and fertilizer
// blackout windows; POST applies one editable change (thresholds or a location/blackout
// add/update/remove). Everything here is config — never the forecast data itself.
export async function GET() {
  const user = await requireAdminUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [thresholds, locations, blackouts] = await Promise.all([
    getThresholds(),
    prisma.weatherLocation.findMany({ orderBy: [{ branch: "asc" }, { createdAt: "asc" }] }).catch(() => []),
    getBlackouts(),
  ]);
  return NextResponse.json({
    thresholds,
    defaults: DEFAULT_THRESHOLDS,
    locations: locations.map((l) => ({ id: l.id, branch: l.branch, name: l.name, lat: l.lat, lon: l.lon, active: l.active, gridResolved: !!l.gridId, radarStation: l.radarStation })),
    blackouts: blackouts.map((b) => ({ id: b.id, branch: b.branch, startMonthDay: b.startMonthDay, endMonthDay: b.endMonthDay, note: b.note })),
  });
}

export async function POST(req: Request) {
  const user = await requireAdminUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const action = str(body?.action);

  try {
    switch (action) {
      case "saveThresholds": {
        const incoming = (body?.thresholds ?? {}) as Record<string, unknown>;
        const next: Partial<Thresholds> = {};
        for (const k of THRESHOLD_KEYS) {
          const v = num(incoming[k]);
          if (v != null && v >= 0) next[k] = v;
        }
        await prisma.weatherSettings.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", thresholds: JSON.stringify(next), updatedById: user.id },
          update: { thresholds: JSON.stringify(next), updatedById: user.id },
        });
        return NextResponse.json({ ok: true, thresholds: { ...DEFAULT_THRESHOLDS, ...next } });
      }
      case "addLocation": {
        const branch = str(body?.branch);
        const name = str(body?.name);
        const lat = num(body?.lat), lon = num(body?.lon);
        if (!branch || !VALID.has(branch)) return NextResponse.json({ error: "Unknown branch." }, { status: 400 });
        if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180)
          return NextResponse.json({ error: "Valid lat/lon required." }, { status: 400 });
        const loc = await prisma.weatherLocation.create({ data: { branch, name: name ?? `${branch} point`, lat, lon } });
        return NextResponse.json({ ok: true, id: loc.id });
      }
      case "updateLocation": {
        const id = str(body?.id);
        if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const lat = num(body?.lat), lon = num(body?.lon);
        const name = str(body?.name);
        const active = typeof body?.active === "boolean" ? body.active : undefined;
        // If lat/lon moved, clear the cached grid so it re-resolves on next fetch.
        const moved = lat != null || lon != null;
        await prisma.weatherLocation.update({
          where: { id },
          data: {
            ...(name ? { name } : {}),
            ...(lat != null ? { lat } : {}),
            ...(lon != null ? { lon } : {}),
            ...(active !== undefined ? { active } : {}),
            ...(moved ? { gridId: null, gridX: null, gridY: null, radarStation: null, forecastUrl: null, forecastHourlyUrl: null, forecastGridDataUrl: null } : {}),
          },
        });
        return NextResponse.json({ ok: true });
      }
      case "deleteLocation": {
        const id = str(body?.id);
        if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        await prisma.weatherLocation.delete({ where: { id } }).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      case "addBlackout": {
        const branch = str(body?.branch);
        const startMonthDay = str(body?.startMonthDay);
        const endMonthDay = str(body?.endMonthDay);
        const note = str(body?.note);
        if (!branch || !VALID.has(branch)) return NextResponse.json({ error: "Unknown branch." }, { status: 400 });
        if (!startMonthDay || !MMDD.test(startMonthDay) || !endMonthDay || !MMDD.test(endMonthDay))
          return NextResponse.json({ error: "Dates must be MM-DD." }, { status: 400 });
        const b = await prisma.fertBlackout.create({ data: { branch, startMonthDay, endMonthDay, note } });
        return NextResponse.json({ ok: true, id: b.id });
      }
      case "deleteBlackout": {
        const id = str(body?.id);
        if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        await prisma.fertBlackout.delete({ where: { id } }).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    console.error("POST /api/weather/settings:", e);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
}
