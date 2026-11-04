import "server-only";
import { prisma } from "@/lib/prisma";

// Runtime cleanup: resolve stale "Registration expiring/expired" Inbox nudges.
// The daily job posts a vehicle-registration notice (Thread) when a vehicle is
// within the 60-day window, stamped `nudge_vehicle_registration:<vid>:<renewalDate>`
// (a Setting whose value is the thread id). After the fleet master reconciliation
// corrected the registration dates (most → 2027, out of window), those notices are
// stale: the vehicle is no longer in-window, or its renewal date changed. This
// resolves each stale thread and drops its stamp so a fresh, valid notice can post
// later if a date really does come due. Dashboard "needs attention" registration
// items are computed live from the dates, so they already cleared — this only
// tidies the stored Inbox notices. Runs once per cold start; non-fatal.

const DAY = 864e5;
const REGISTRATION_WINDOW_DAYS = 60;
let _ran = false;

export async function ensureStaleRegistrationNudgesCleared(): Promise<void> {
  if (_ran) return;
  try {
    const now = Date.now();
    const stamps = await prisma.setting.findMany({ where: { key: { startsWith: "nudge_vehicle_registration:" } } });
    if (!stamps.length) { _ran = true; return; }
    let cleared = 0;
    for (const s of stamps) {
      const parts = s.key.split(":"); // ["nudge_vehicle_registration", "<vid>", "<yyyy-mm-dd>"]
      const vid = parts[1];
      const stampDate = parts[2] ?? "none";
      if (!vid) continue;
      const v = await prisma.vehicle.findUnique({ where: { id: vid }, select: { registrationRenewal: true } }).catch(() => null);
      const reg = v?.registrationRenewal ?? null;
      const curKey = reg ? reg.toISOString().slice(0, 10) : "none";
      const inWindow = reg ? (reg.getTime() - now) / DAY <= REGISTRATION_WINDOW_DAYS : false;
      const stale = !inWindow || stampDate !== curKey;
      if (!stale) continue;
      if (s.value) await prisma.thread.updateMany({ where: { id: s.value }, data: { status: "resolved" } }).catch(() => {});
      await prisma.setting.delete({ where: { key: s.key } }).catch(() => {});
      cleared++;
    }
    _ran = true;
    if (cleared) console.log(`ensureStaleRegistrationNudgesCleared: resolved ${cleared} stale registration notice(s).`);
  } catch (e) {
    console.error("ensureStaleRegistrationNudgesCleared failed (non-fatal):", e);
  }
}
