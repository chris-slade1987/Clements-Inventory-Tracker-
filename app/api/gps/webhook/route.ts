import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { collectPlots, persistPlots, isVerizonPositionType } from "@/lib/gps-webhook";

export const runtime = "nodejs";
export const maxDuration = 60;

// PUBLIC receiver for Verizon Connect Reveal push events (GPS plots + alerts —
// there is NO Alerts REST API). Verizon Connect calls this URL; it's submitted
// in Reveal → Admin → Integrations and confirmed on the developer side.
//
// Auth: Reveal authenticates to us with HTTP Basic auth — a username/password we
// choose, entered in the Reveal webhook form and mirrored into our env. Precedence:
//   1. If VERIZON_WEBHOOK_USERNAME (or _USER) + VERIZON_WEBHOOK_PASSWORD are set →
//      require a matching `Authorization: Basic <base64(user:pass)>` on POST.
//   2. Else if VERIZON_WEBHOOK_TOKEN is set → require it as ?token=… (legacy).
//   3. Else → open (no protection configured).
// We store the raw body as a GpsWebhookEvent, best-effort parse GPS plots into
// GpsPosition (so pushed positions reach the live map), return 200 fast, and
// never echo credentials back.

function webhookUser(): string | undefined {
  return process.env.VERIZON_WEBHOOK_USERNAME || process.env.VERIZON_WEBHOOK_USER;
}
function basicConfigured(): boolean {
  return !!(webhookUser() && process.env.VERIZON_WEBHOOK_PASSWORD);
}

function authOk(req: Request): boolean {
  const user = webhookUser();
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
  const expected = process.env.VERIZON_WEBHOOK_TOKEN;
  if (!expected) return true;
  return new URL(req.url).searchParams.get("token") === expected;
}

function unauthorized(): NextResponse {
  const res = NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (basicConfigured()) res.headers.set("WWW-Authenticate", 'Basic realm="gps-webhook"');
  return res;
}

// ---- confirmation / handshake detection -----------------------------------
// Verizon Connect's GPS Push Service confirms a submitted webhook with a
// SUBSCRIPTION CONFIRMATION message as the FIRST POST to our endpoint, which we
// must acknowledge (within 3 days). It may arrive WITHOUT our Basic auth, so we
// handle it BEFORE the auth check — otherwise we'd 401 the confirmation and the
// subscription would never activate.

const CHALLENGE_KEYS = ["challenge", "verificationToken", "validationToken", "verification"];
const CONFIRM_URL_KEYS = ["SubscribeURL", "subscribeUrl", "confirmUrl", "confirmationUrl", "callbackUrl"];

function firstKey(o: Record<string, unknown> | null, keys: string[]): string | null {
  if (!o) return null;
  for (const k of keys) {
    const v = o[k] ?? o[k.toLowerCase()] ?? o[k.charAt(0).toUpperCase() + k.slice(1)];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

// Deep-scan the raw body for an SNS-style SubscribeURL, so we catch it even when
// the JSON structure isn't exactly what we expect.
function subscribeUrlFromRaw(body: string): string | null {
  const m =
    body.match(/"SubscribeURL"\s*:\s*"([^"]+)"/i) ||
    body.match(/(https?:\/\/[^\s"']*(?:subscri|confirm)[^\s"']*)/i);
  return m ? m[1] : null;
}

type Confirmation = { isConfirmation: boolean; challenge: string | null; confirmUrl: string | null };

function detectConfirmation(url: URL, json: Record<string, unknown> | null): Confirmation {
  // Query-string challenge (some providers verify this way even on POST).
  let challenge: string | null = null;
  for (const k of CHALLENGE_KEYS) {
    challenge = url.searchParams.get(k);
    if (challenge) break;
  }
  challenge = challenge || url.searchParams.get("token");
  // Body challenge / confirmation type / confirmation callback URL.
  const bodyChallenge = firstKey(json, CHALLENGE_KEYS);
  if (bodyChallenge) challenge = challenge || bodyChallenge;
  const t = json ? (json.type ?? json.Type) : undefined;
  const isSubType = typeof t === "string" && t.toLowerCase() === "subscriptionconfirmation";
  const confirmUrl = firstKey(json, CONFIRM_URL_KEYS);
  const isConfirmation = Boolean(challenge || isSubType || confirmUrl);
  return { isConfirmation, challenge, confirmUrl };
}

async function store(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const body = await req.text().catch(() => "");
  const hasAuthHeader = Boolean(req.headers.get("authorization"));
  const contentType = req.headers.get("content-type") ?? "?";
  const snippet = body.slice(0, 500).replace(/\s+/g, " ");

  // (1) Log EVERY incoming POST at entry, BEFORE auth. Never log secrets — only
  //     whether an Authorization header was present, plus a truncated snippet.
  console.log(
    `[gps-webhook] POST auth=${hasAuthHeader} content-type=${contentType} bytes=${body.length} snippet="${snippet}"`,
  );

  // Parse the body once (best-effort). Used for confirmation detection + plots.
  let json: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch {
    // Not JSON — leave null; we still store the raw payload below.
  }

  let type: string | null = null;
  let verizonNumber: string | null = null;
  if (json) {
    const t = json.type ?? json.Type ?? json.eventType ?? json.EventType ?? json.alertType ?? json.AlertType;
    if (typeof t === "string") type = t;
    const vn = json.vehicleNumber ?? json.VehicleNumber ?? json.vehicleId ?? json.VehicleId ?? json.number ?? json.Number;
    if (typeof vn === "string") verizonNumber = vn;
    else if (typeof vn === "number") verizonNumber = String(vn);
  }

  // Store EVERY inbound POST as a webhook event up front — so the confirmation
  // message (and anything unexpected) is always inspectable on the GPS Setup
  // page, even if it doesn't match a known shape or fails auth below.
  const event = await prisma.gpsWebhookEvent
    .create({ data: { type, verizonNumber, payload: body.slice(0, 100000), processed: false } })
    .catch(() => null);

  // (2) Subscription-confirmation handling — BEFORE requiring Basic auth.
  // Fleetmatics' GPS Push is AWS SNS-based: the confirmation message carries a
  // SubscribeURL we must GET to acknowledge. Detect it via body keys, the SNS
  // message-type header, OR a SubscribeURL found anywhere in the raw body (deep
  // scan) so an unexpected structure still confirms. Verizon's confirmation may
  // arrive WITHOUT our Basic auth, so this runs before the auth gate.
  const snsType = (req.headers.get("x-amz-sns-message-type") ?? "").toLowerCase();
  const confirm = detectConfirmation(url, json);
  const confirmUrl = confirm.confirmUrl || subscribeUrlFromRaw(body);
  if (confirm.isConfirmation || snsType === "subscriptionconfirmation" || confirmUrl) {
    console.log(`[gps-webhook] subscription confirmation received sns="${snsType || "-"}" hasUrl=${Boolean(confirmUrl)} snippet="${snippet}"`);
    if (event) {
      await prisma.gpsWebhookEvent.update({ where: { id: event.id }, data: { type: type ?? "SubscriptionConfirmation", processed: true } }).catch(() => {});
    }
    // GET the SubscribeURL to complete the handshake (best-effort; log the result
    // so we can see whether Verizon accepted it).
    if (confirmUrl) {
      try {
        const res = await fetch(confirmUrl, { method: "GET", redirect: "follow" });
        const respText = (await res.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
        console.log(`[gps-webhook] SubscribeURL GET status=${res.status} body="${respText}"`);
      } catch (e) {
        console.log(`[gps-webhook] SubscribeURL GET failed: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    // Echo any challenge/token so a challenge-response verification also succeeds.
    if (confirm.challenge) {
      return new NextResponse(confirm.challenge, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return NextResponse.json({ ok: true, confirmed: true });
  }

  // (3) Real GPS plot deliveries. Normally require Basic auth — BUT Verizon
  // Connect's Integration Platform pushes CloudEvents (e.g.
  // com.verizonconnect.integrations.vehicle.position.updated) that may NOT carry
  // our Basic credentials. Rejecting those would drop live fleet data on the
  // floor. So: recognized Verizon position events are accepted even without auth
  // (they're already stored + logged above); everything else still needs auth.
  const authed = authOk(req);
  const recognized = isVerizonPositionType(type);
  if (!authed && !recognized) {
    console.log(`[gps-webhook] 401 unauthorized (auth header ${hasAuthHeader ? "present but mismatched" : "missing"}, type=${type ?? "?"})`);
    return unauthorized();
  }
  if (!authed && recognized) {
    console.log(`[gps-webhook] accepting recognized Verizon event without Basic auth (type=${type ?? "?"})`);
  }

  const plots = json ? collectPlots(json) : [];
  const saved = plots.length ? await persistPlots(prisma, plots) : 0;
  if (event) {
    await prisma.gpsWebhookEvent.update({ where: { id: event.id }, data: { processed: saved > 0 } }).catch(() => {});
  }
  // Brief, secret-free delivery log so the first real webhook is visible in logs.
  console.log(`[gps-webhook] delivery type=${type ?? "?"} vehicle=${verizonNumber ?? "?"} plots=${plots.length} saved=${saved} bytes=${body.length}`);

  // Refresh GPS alerts off any newly-saved real plots (lightweight, best-effort).
  if (saved > 0) {
    try {
      const { detectGpsIssues } = await import("@/lib/gps-detect");
      await detectGpsIssues();
    } catch {
      // Detection must never fail the delivery.
    }
  }

  return NextResponse.json({ ok: true, received: plots.length, saved });
}

export async function POST(req: Request) {
  return store(req);
}

// Reveal (and most providers) verify an endpoint with a GET first. Always answer
// 200, and echo back any challenge/verification token so a challenge-response
// verification succeeds. Real event delivery is POST + Basic auth.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const challenge =
    url.searchParams.get("challenge") ||
    url.searchParams.get("verificationToken") ||
    url.searchParams.get("validationToken") ||
    url.searchParams.get("verification") ||
    url.searchParams.get("token");
  console.log(`[gps-webhook] GET verification${challenge ? " (challenge present)" : ""}`);
  if (challenge) {
    // Echo the raw challenge as plain text (common) AND include it in JSON.
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ ok: true });
}
