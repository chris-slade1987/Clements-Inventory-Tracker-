import "server-only";
import { prisma } from "@/lib/prisma";

// Runtime healer: correct the Thanksgiving (11/25) and Christmas (12/24) early-release
// close times on the Company Calendar from "1:00 PM" to "3:00 PM" (COO correction,
// 2026-11-04). The bulletin seed only inserts events when the calendar is empty, so
// existing prod rows need this targeted fix. Idempotent (only touches rows still at
// 1:00 PM) and date-scoped so it never changes Labor Day, which really does close at 1 PM.
// Non-fatal.

let _ran = false;

export async function ensureHolidayCloseTimes(): Promise<void> {
  if (_ran) return;
  try {
    const res = await prisma.calendarEvent.updateMany({
      where: {
        kind: "early_release",
        timeLabel: "Closing 1:00 PM",
        OR: [
          { date: { gte: new Date("2026-11-25T00:00:00.000Z"), lt: new Date("2026-11-26T00:00:00.000Z") } },
          { date: { gte: new Date("2026-12-24T00:00:00.000Z"), lt: new Date("2026-12-25T00:00:00.000Z") } },
        ],
      },
      data: { timeLabel: "Closing 3:00 PM" },
    });
    _ran = true;
    if (res.count) console.log(`ensureHolidayCloseTimes: corrected ${res.count} early-release close time(s) to 3:00 PM.`);
  } catch (e) {
    console.error("ensureHolidayCloseTimes failed (non-fatal):", e);
  }
}
