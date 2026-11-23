import "server-only";
import { prisma } from "@/lib/prisma";
import { ingestRoutingReport } from "@/lib/routing-ingest";

// Runtime loader for a committed PestPac Technician Schedule Report — next month's
// route schedule for Routes (Routing Approval). Production data only changes at
// runtime, so this heals the month in on first authenticated load, through the SAME
// ingest the Routes upload uses (ingestRoutingReport: one RoutingMonth per branch,
// status "open" for review + sign-off).
//
// Revisioned (Setting `routing_sched_rev:<period>`): a bumped revision re-ingests;
// an unchanged one is a no-op. A month someone already uploaded in the portal (it
// has stops and no marker) is NEVER overwritten — the marker is just stamped.
//
// 2026-12 rev 1 — COO 2026-11-23: December schedule, run 11/23 12:52 PM.

let _ran = false;

export async function ensureRoutingSchedules(): Promise<void> {
  if (_ran) return;
  try {
    const data = (await import("@/prisma/data/routing-schedule-2026-12.json")).default as {
      revision?: number; periodKey: string; source?: string; text: string;
    };
    const rev = String(data.revision ?? 1);
    const markerKey = `routing_sched_rev:${data.periodKey}`;
    const marker = await prisma.setting.findUnique({ where: { key: markerKey } });
    if (marker?.value === rev) { _ran = true; return; }

    const stamp = () => prisma.setting.upsert({ where: { key: markerKey }, update: { value: rev }, create: { key: markerKey, value: rev } });

    // First time (no marker) and the month already has stops → a real upload; keep it.
    if (!marker) {
      const existing = await prisma.routeStop.count({ where: { routingMonth: { periodKey: data.periodKey } } });
      if (existing > 0) { await stamp(); _ran = true; return; }
    }

    const res = await ingestRoutingReport({
      text: data.text,
      fileName: data.source ?? `Technician Schedule Report (${data.periodKey})`,
      uploadedByName: "Chris Slade",
    });
    if (res.ok) {
      await stamp();
      _ran = true;
      console.log(`ensureRoutingSchedules: loaded ${data.periodKey} —`, JSON.stringify(res.months));
    }
    // If not ok, leave _ran false so a later load retries.
  } catch (e) {
    console.error("ensureRoutingSchedules failed (non-fatal):", e);
  }
}
