import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { setGpsAlertStatus } from "@/lib/gps-detect";

export const runtime = "nodejs";

// Acknowledge or dismiss a GPS alert. Admin + manager only (board observers and
// employees are blocked). Never hard-deletes — flips status and records who/when
// via setGpsAlertStatus. Body: { action: "ack" | "dismiss", id: string }.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (user.role !== "admin" && user.role !== "manager") {
    return NextResponse.json({ error: "Only an admin or manager may update GPS alerts." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string };
  const action = body.action;
  if (!body.id || (action !== "ack" && action !== "dismiss")) {
    return NextResponse.json({ error: "Provide an alert id and action ('ack' | 'dismiss')." }, { status: 400 });
  }

  const ok = await setGpsAlertStatus(body.id, action, user.name);
  if (!ok) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  return NextResponse.json({ ok: true, id: body.id, status: action === "ack" ? "ack" : "dismissed" });
}
