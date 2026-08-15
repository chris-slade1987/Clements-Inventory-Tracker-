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
import { collectPlots } from "@/lib/gps-webhook";

export const runtime = "nodejs";
export const maxDuration = 20;

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

  // Build marker — if you can SEE these fields (build tag, linked/unlinked
  // split, the exact date param), the deployment includes the GPS fixes. If the
  // date sample below still ends in ".NNNZ", you're on the OLD build and the
  // status/history 500 fix hasn't deployed.
  out.build = { tag: "gps-fixes-5", statusHistoryStartParamSample: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19) };

  // 4) Stored local state + recent webhook events. Split positions by whether
  //    they linked to a fleet vehicle — the difference tells us if the problem
  //    is "no data landing" vs. "data landing but not matched to our vehicles".
  const [realPositions, linkedPositions, linkedVehicles, distinctNums, events, webhookTotal, webhookByType] = await Promise.all([
    prisma.gpsPosition.count({ where: { sample: false } }),
    prisma.gpsPosition.count({ where: { sample: false, vehicleId: { not: null } } }),
    prisma.vehicle.count({ where: { verizonNumber: { not: null } } }),
    prisma.gpsPosition.findMany({ where: { sample: false }, select: { verizonNumber: true }, distinct: ["verizonNumber"], take: 50 }),
    prisma.gpsWebhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 10 }),
    prisma.gpsWebhookEvent.count(),
    prisma.gpsWebhookEvent.groupBy({ by: ["type"], _count: { _all: true } }),
  ]);
  // The single most diagnostic push-path signal: total inbound webhook POSTs and
  // their type breakdown. If the ONLY events are SubscriptionConfirmation (or the
  // total is 0), Verizon has never actually pushed a position plot — the problem
  // is the Reveal subscription config, not our receiver.
  // Grab the most recent position-type event's RAW payload + a parsed preview so
  // we can confirm the exact CloudEvents field names and that the parser now
  // resolves lat/lng from them.
  const lastPositionEvent = await prisma.gpsWebhookEvent.findFirst({
    where: { NOT: { type: { contains: "SubscriptionConfirmation" } } },
    orderBy: { receivedAt: "desc" },
    select: { type: true, receivedAt: true, payload: true },
  });
  let lastPayloadSample: unknown = null;
  let lastParsedPreview: unknown = null;
  if (lastPositionEvent?.payload) {
    try {
      lastPayloadSample = JSON.parse(lastPositionEvent.payload);
      const plots = collectPlots(lastPayloadSample);
      lastParsedPreview = { plotsFound: plots.length, first: plots[0] ?? null };
    } catch {
      lastPayloadSample = lastPositionEvent.payload.slice(0, 2000);
    }
  }
  out.webhook = {
    totalEvents: webhookTotal,
    byType: Object.fromEntries(webhookByType.map((r) => [r.type ?? "(null)", r._count._all])),
    lastEventType: lastPositionEvent?.type ?? null,
    lastEventAt: lastPositionEvent?.receivedAt ?? null,
    lastPayloadSample,
    lastParsedPreview,
  };
  out.local = {
    realPositions,
    linkedPositions,
    unlinkedPositions: realPositions - linkedPositions,
    verizonNumbersSeenInPositions: distinctNums.map((d) => d.verizonNumber),
    vehiclesLinkedToVerizon: linkedVehicles,
    recentWebhookEvents: events.map((e) => ({
      id: e.id,
      type: e.type,
      receivedAt: e.receivedAt,
      snippet: (e.payload ?? "").slice(0, 300).replace(/\s+/g, " "),
    })),
  };

  return NextResponse.json(out);
}
