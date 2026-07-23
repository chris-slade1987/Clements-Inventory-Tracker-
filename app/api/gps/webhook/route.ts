import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// PUBLIC receiver for Verizon Connect Reveal push events (alerts arrive via
// webhooks — there is NO Alerts REST API). Verizon Connect calls this URL; the
// CEO submits it in Reveal → Admin → Integrations.
//
// Security: NO auth session (Verizon can't log in). If VERIZON_WEBHOOK_TOKEN is
// set, the request MUST carry it as ?token=… (401 otherwise). We do minimal work
// — store the raw body as a GpsWebhookEvent and return 200 quickly. Never echo
// the token or any secret back.

function tokenOk(req: Request): boolean {
  const expected = process.env.VERIZON_WEBHOOK_TOKEN;
  if (!expected) return true; // token protection not enabled
  const url = new URL(req.url);
  return url.searchParams.get("token") === expected;
}

async function store(req: Request): Promise<NextResponse> {
  if (!tokenOk(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.text().catch(() => "");

  // Best-effort parse of an event type + vehicle number from common shapes.
  let type: string | null = null;
  let verizonNumber: string | null = null;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const t = json.type ?? json.Type ?? json.eventType ?? json.EventType ?? json.alertType ?? json.AlertType;
    if (typeof t === "string") type = t;
    const vn = json.vehicleNumber ?? json.VehicleNumber ?? json.vehicleId ?? json.VehicleId ?? json.number ?? json.Number;
    if (typeof vn === "string") verizonNumber = vn;
    else if (typeof vn === "number") verizonNumber = String(vn);
  } catch {
    // Not JSON (or empty) — still store the raw payload for later inspection.
  }

  await prisma.gpsWebhookEvent.create({
    data: { type, verizonNumber, payload: body.slice(0, 100000), processed: false },
  });

  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  return store(req);
}

// Some webhook providers verify an endpoint with a GET first — accept it.
export async function GET(req: Request) {
  if (!tokenOk(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
