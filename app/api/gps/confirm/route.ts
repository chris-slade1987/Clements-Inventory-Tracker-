import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

// Admin tool to complete the Verizon Connect Reveal GPS Push subscription.
// Fleetmatics' GPS Push is AWS SNS-based: the first message is a
// SubscriptionConfirmation carrying a top-level `SubscribeURL` that must be
// GET-visited to confirm. The webhook receiver auto-visits it on arrival, but
// this route lets an admin SEE the stored confirmation message and re-fire the
// GET on demand (or paste a URL manually) if the auto attempt didn't stick.

const CONFIRM_URL_KEYS = ["SubscribeURL", "subscribeUrl", "subscribeurl", "confirmUrl", "confirmationUrl", "callbackUrl", "ConfirmURL"];

function extractSubscribeUrl(payload: string): string | null {
  // Try JSON first.
  try {
    const o = JSON.parse(payload) as Record<string, unknown>;
    for (const k of CONFIRM_URL_KEYS) {
      const v = o[k];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }
  } catch {
    // not JSON
  }
  // Fallback: regex a SubscribeURL out of the raw text.
  const m =
    payload.match(/"SubscribeURL"\s*:\s*"([^"]+)"/i) ||
    payload.match(/(https?:\/\/[^\s"']*[Ss]ubscri[^\s"']*)/);
  return m ? m[1] : null;
}

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

// GET → recent webhook events + any detected SubscribeURL, so an admin can see
// whether Verizon's confirmation message arrived and what it contained.
export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const events = await prisma.gpsWebhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 20 });
  const rows = events.map((e) => ({
    id: e.id,
    type: e.type,
    verizonNumber: e.verizonNumber,
    receivedAt: e.receivedAt,
    snippet: (e.payload ?? "").slice(0, 400).replace(/\s+/g, " "),
    subscribeUrl: extractSubscribeUrl(e.payload ?? ""),
  }));
  const latestUrl = rows.find((r) => r.subscribeUrl)?.subscribeUrl ?? null;
  return NextResponse.json({ ok: true, count: rows.length, latestSubscribeUrl: latestUrl, events: rows });
}

// POST { action:"confirm", url? } → GET the SubscribeURL (from the latest stored
// confirmation message, or a URL provided explicitly) to complete the handshake.
export async function POST(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  let url: string | null = typeof body?.url === "string" && body.url.trim() ? body.url.trim() : null;

  if (!url) {
    const events = await prisma.gpsWebhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 20 });
    for (const e of events) {
      const found = extractSubscribeUrl(e.payload ?? "");
      if (found) { url = found; break; }
    }
  }
  if (!url) {
    return NextResponse.json(
      { error: "No SubscribeURL found. Verizon's confirmation message hasn't arrived yet — resubmit the webhook in Reveal → Admin → Integrations, then try again. Or paste the SubscribeURL manually." },
      { status: 404 },
    );
  }
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "That doesn't look like a URL." }, { status: 400 });
  }

  try {
    const res = await fetch(url, { method: "GET" });
    const text = (await res.text().catch(() => "")).slice(0, 500);
    console.log(`[gps-webhook] manual confirm GET status=${res.status} url-host=${new URL(url).host}`);
    return NextResponse.json({ ok: res.ok, status: res.status, body: text, url });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Request failed" }, { status: 502 });
  }
}
