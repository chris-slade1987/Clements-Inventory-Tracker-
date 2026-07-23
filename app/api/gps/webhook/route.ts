import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

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

// ---- lenient plot parsing --------------------------------------------------
type Plot = {
  verizonNumber: string;
  ts: Date;
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  ignition?: boolean | null;
  address?: string | null;
  odometer?: number | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
}
function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "on", "1", "yes"].includes(s)) return true;
    if (["false", "off", "0", "no"].includes(s)) return false;
  }
  return null;
}

function parsePlot(o: Record<string, unknown>): Plot | null {
  const vnRaw = pick(o, ["vehicleNumber", "VehicleNumber", "vehicleId", "VehicleId", "number", "Number", "vehicle", "Vehicle"]);
  const vn = typeof vnRaw === "string" ? vnRaw : typeof vnRaw === "number" ? String(vnRaw) : null;
  const lat = num(pick(o, ["latitude", "Latitude", "lat", "Lat"]));
  const lng = num(pick(o, ["longitude", "Longitude", "lng", "Lng", "lon", "Lon", "long", "Long"]));
  if (!vn || lat == null || lng == null) return null;
  const tsRaw = pick(o, ["timestamp", "Timestamp", "eventTime", "EventTime", "gpsTime", "GpsTime", "utcTimestamp", "updateUtc", "time", "Time", "dateTimeUtc"]);
  const ts = tsRaw != null ? new Date(String(tsRaw)) : new Date();
  return {
    verizonNumber: vn,
    ts: isNaN(ts.getTime()) ? new Date() : ts,
    lat,
    lng,
    speed: num(pick(o, ["speed", "Speed", "speedMph", "speedKph"])),
    heading: num(pick(o, ["heading", "Heading", "direction", "Direction", "bearing", "Bearing"])),
    ignition: toBool(pick(o, ["ignition", "Ignition", "ignitionOn", "IgnitionOn", "engineOn"])),
    address: (() => { const a = pick(o, ["address", "Address", "location", "Location"]); return typeof a === "string" ? a : null; })(),
    odometer: num(pick(o, ["odometer", "Odometer", "mileage", "Mileage"])),
  };
}

// A payload may be a single plot, an array of plots, or an object wrapping an
// array under a common key. Collect whatever plots we can find.
function collectPlots(json: unknown): Plot[] {
  const out: Plot[] = [];
  const consider = (v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const p = parsePlot(v as Record<string, unknown>);
      if (p) out.push(p);
    }
  };
  if (Array.isArray(json)) json.forEach(consider);
  else if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const arr = pick(o, ["plots", "Plots", "events", "Events", "data", "Data", "items", "Items", "records", "Records"]);
    if (Array.isArray(arr)) arr.forEach(consider);
    else consider(json);
  }
  return out;
}

async function persistPlots(plots: Plot[]): Promise<number> {
  let saved = 0;
  // Cache vehicle lookups by verizonNumber within this delivery.
  const cache = new Map<string, string | null>();
  for (const p of plots) {
    let vehicleId = cache.get(p.verizonNumber);
    if (vehicleId === undefined) {
      const v = await prisma.vehicle.findFirst({ where: { verizonNumber: p.verizonNumber }, select: { id: true } });
      vehicleId = v?.id ?? null;
      cache.set(p.verizonNumber, vehicleId);
    }
    try {
      await prisma.gpsPosition.upsert({
        where: { verizonNumber_ts: { verizonNumber: p.verizonNumber, ts: p.ts } },
        update: { lat: p.lat, lng: p.lng, speed: p.speed ?? undefined, heading: p.heading ?? undefined, ignition: p.ignition ?? undefined, address: p.address ?? undefined, odometer: p.odometer ?? undefined, vehicleId: vehicleId ?? undefined, sample: false },
        create: { vehicleId: vehicleId ?? null, verizonNumber: p.verizonNumber, ts: p.ts, lat: p.lat, lng: p.lng, speed: p.speed ?? null, heading: p.heading ?? null, ignition: p.ignition ?? null, address: p.address ?? null, odometer: p.odometer ?? null, sample: false },
      });
      saved++;
    } catch {
      // Never let a single bad plot fail the delivery.
    }
  }
  return saved;
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

  // (2) Subscription-confirmation handling — BEFORE requiring Basic auth.
  const confirm = detectConfirmation(url, json);
  if (confirm.isConfirmation) {
    console.log(`[gps-webhook] subscription confirmation received snippet="${snippet}"`);
    // Always store the raw payload so we can inspect the confirmation later.
    await prisma.gpsWebhookEvent
      .create({ data: { type: type ?? "SubscriptionConfirmation", verizonNumber, payload: body.slice(0, 100000), processed: true } })
      .catch(() => {});
    // If a confirmation callback URL is present, GET it to acknowledge (best-effort).
    if (confirm.confirmUrl) {
      try {
        const res = await fetch(confirm.confirmUrl, { method: "GET" });
        console.log(`[gps-webhook] confirmation callback GET status=${res.status}`);
      } catch (e) {
        console.log(`[gps-webhook] confirmation callback GET failed: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    // Echo any challenge/token so a challenge-response verification succeeds.
    if (confirm.challenge) {
      return new NextResponse(confirm.challenge, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return NextResponse.json({ ok: true, confirmed: true });
  }

  // (3) Real GPS plot deliveries — require Basic auth; log the 401 first.
  if (!authOk(req)) {
    console.log(`[gps-webhook] 401 unauthorized (auth header ${hasAuthHeader ? "present but mismatched" : "missing"})`);
    return unauthorized();
  }

  const plots = json ? collectPlots(json) : [];

  await prisma.gpsWebhookEvent.create({
    data: { type, verizonNumber, payload: body.slice(0, 100000), processed: plots.length > 0 },
  });

  const saved = plots.length ? await persistPlots(plots) : 0;
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
