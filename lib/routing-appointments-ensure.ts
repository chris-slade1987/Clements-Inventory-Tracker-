import "server-only";
import { prisma } from "@/lib/prisma";
import { ingestAppointmentSchedule } from "@/lib/routing-appointments";

// Runtime loader for the committed PestPac Appointment List (the per-day timed route
// schedule). The build-time deploy seed doesn't reliably reach the live DB, so this
// heals the month in on first authenticated load, reusing the SAME ingest the upload
// endpoint uses. Revisioned (Setting `routing_appts_rev:<period>`): a bumped revision
// re-ingests (replace); an unchanged one is a no-op fast-path. Heavy but once; non-fatal.

let _ran = false;

export async function ensureRoutingAppointments(): Promise<void> {
  if (_ran) return;
  try {
    const data = (await import("@/prisma/data/appointments-2026-11.json")).default as {
      revision?: number; periodKey: string; source?: string; text: string;
    };
    const rev = String(data.revision ?? 1);
    const markerKey = `routing_appts_rev:${data.periodKey}`;
    const marker = await prisma.setting.findUnique({ where: { key: markerKey } });
    if (marker?.value === rev) { _ran = true; return; }

    const res = await ingestAppointmentSchedule({
      text: data.text,
      fileName: data.source ?? `Appointment List (${data.periodKey})`,
      uploadedByName: "Chris Slade",
    });
    if (res.ok) {
      await prisma.setting.upsert({ where: { key: markerKey }, update: { value: rev }, create: { key: markerKey, value: rev } });
      _ran = true;
      console.log(`ensureRoutingAppointments: loaded ${data.periodKey} —`, JSON.stringify(res.months));
    }
    // If not ok, leave _ran false so a later load retries.
  } catch (e) {
    console.error("ensureRoutingAppointments failed (non-fatal):", e);
  }
}
