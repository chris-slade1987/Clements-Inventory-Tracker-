import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { syncFleet } from "@/lib/gps";

export const runtime = "nodejs";

// Run a GPS fleet sync. Admin only — this is what the Live Map "Refresh" button
// and a scheduled cron call. syncFleet() never throws; it captures errors into a
// GpsSyncLog and returns them, so we always respond cleanly.
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Only an admin may sync GPS data." }, { status: 403 });
  }

  const result = await syncFleet();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
