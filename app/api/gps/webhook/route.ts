import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// PUBLIC receiver for Verizon Connect Reveal push events (alerts arrive via
// webhooks — there is NO Alerts REST API). Verizon Connect calls this URL; the
// CEO submits it in Reveal → Admin → Integrations.
//
// Security: NO auth session (Verizon can't log in). Reveal authenticates to us
// with HTTP Basic auth — a username/password WE choose, entered in the Reveal
// webhook form and mirrored into our env. Auth precedence:
//   1. If VERIZON_WEBHOOK_USER + VERIZON_WEBHOOK_PASSWORD are set → require a
//      matching `Authorization: Basic <base64(user:pass)>` header on POST.
//   2. Else if VERIZON_WEBHOOK_TOKEN is set → require it as ?token=… (legacy).
//   3. Else → open (no protection configured).
// We do minimal work — store the raw body as a GpsWebhookEvent and return 200
// quickly. Never echo credentials or any secret back.

function basicConfigured(): boolean {
  return !!(process.env.VERIZON_WEBHOOK_USER && process.env.VERIZON_WEBHOOK_PASSWORD);
}

function authOk(req: Request): boolean {
  const user = process.env.VERIZON_WEBHOOK_USER;
  const pass = process.env.VERIZON_WEBHOOK_PASSWORD;
  if (user && pass) {
    const header = req.headers.get("authorization") ?? "";
    if (!header.startsWith("Basic ")) return false;
    let decoded = "";
    try {
      decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    } catch {
      return false;
    }
    const idx = decoded.indexOf(":");
    if (idx === -1) return false;
    return decoded.slice(0, idx) === user && decoded.slice(idx + 1) === pass;
  }
  // Legacy fallback: optional query token when Basic auth isn't configured.
  const expected = process.env.VERIZON_WEBHOOK_TOKEN;
  if (!expected) return true;
  return new URL(req.url).searchParams.get("token") === expected;
}

function unauthorized(): NextResponse {
  const res = NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (basicConfigured()) res.headers.set("WWW-Authenticate", 'Basic realm="gps-webhook"');
  return res;
}

async function store(req: Request): Promise<NextResponse> {
  if (!authOk(req)) return unauthorized();

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

// Reveal (and most providers) verify an endpoint with a GET first — always
// answer 200 so verification succeeds; real event delivery is POST + Basic auth.
export async function GET() {
  return NextResponse.json({ ok: true });
}
