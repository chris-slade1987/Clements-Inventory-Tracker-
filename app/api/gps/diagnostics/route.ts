import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  isConfigured,
  getToken,
  listVehicles,
  statusHistory,
  normalizeVehicle,
  normalizeStatus,
} from "@/lib/verizon";

export const runtime = "nodejs";

// Admin-only GPS diagnostics: exercises the LIVE Verizon REST path and surfaces
// raw responses so we can see exactly why positions aren't landing (empty
// history vs. a parser/field mismatch), plus the stored webhook events. Runs
// only in an environment with the VERIZON_* creds (prod); safe/no-op otherwise.

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const out: Record<string, unknown> = { configured: isConfigured() };

  if (isConfigured()) {
    // 1) Token
    try {
      const tok = await getToken();
      out.token = { ok: true, length: tok?.length ?? 0 };
    } catch (e) {
      out.token = { ok: false, error: errMsg(e) };
    }

    // 2) Vehicle list — count + first raw record + parsed identity
    let firstNumber: string | undefined;
    try {
      const vehicles = await listVehicles();
      const firstRaw = vehicles[0] ?? null;
      const ident = firstRaw ? normalizeVehicle(firstRaw) : null;
      firstNumber = ident?.number;
      out.vehicles = {
        ok: true,
        count: vehicles.length,
        firstRaw, // so we can see the actual field names Verizon uses
        firstIdentity: ident,
      };
    } catch (e) {
      out.vehicles = { ok: false, error: errMsg(e) };
    }

    // 3) Status/history for the first vehicle — try a 7-day window AND no-window,
    //    returning raw + normalized so we can see if it's empty or a field mismatch.
    if (firstNumber) {
      const end = new Date();
      const start = new Date(end.getTime() - 7 * 864e5);
      for (const [label, opts] of [["windowed7d", { start, end }], ["noWindow", {}]] as const) {
        try {
          const hist = await statusHistory(firstNumber, opts);
          out[`statusHistory_${label}`] = {
            ok: true,
            vehicleNumber: firstNumber,
            count: hist.length,
            firstRaw: hist[0] ?? null,
            firstNormalized: hist[0] ? normalizeStatus(hist[0]) : null,
          };
        } catch (e) {
          out[`statusHistory_${label}`] = { ok: false, vehicleNumber: firstNumber, error: errMsg(e) };
        }
      }
    }
  }

  // 4) Stored local state + recent webhook events
  const [positions, linkedVehicles, events] = await Promise.all([
    prisma.gpsPosition.count({ where: { sample: false } }),
    prisma.vehicle.count({ where: { verizonNumber: { not: null } } }),
    prisma.gpsWebhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 10 }),
  ]);
  out.local = {
    realPositions: positions,
    linkedVehicles,
    recentWebhookEvents: events.map((e) => ({
      id: e.id,
      type: e.type,
      receivedAt: e.receivedAt,
      snippet: (e.payload ?? "").slice(0, 300).replace(/\s+/g, " "),
    })),
  };

  return NextResponse.json(out);
}
