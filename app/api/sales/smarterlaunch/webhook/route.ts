import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  webhookSecretConfigured,
  getWebhookSecret,
  smarterLaunchConfigured,
  hasBudget,
  fetchProposal,
  normalizeProposal,
  upsertLead,
  loadAdvisorMaps,
  type NormalizedLead,
} from "@/lib/smarterlaunch";

export const runtime = "nodejs";
export const maxDuration = 20;

// SmarterLaunch outbound webhook receiver (Automations → "Webhook" action, POST).
// Server-to-server (NO user session). Every request carries a `Signature` header
// whose value is the account webhook signature key — a STATIC shared secret we
// compare constant-time against SMARTERLAUNCH_WEBHOOK_SECRET.
//
// SmarterLaunch does NOT document the payload schema, so (like the GPS webhook)
// we STORE EVERY RAW EVENT first, parse leniently, and never assume a shape. We
// return 200 fast; a lead that references a proposal but lacks detail is enriched
// best-effort with ONE quota-aware client call — never blocking the 200.

/** Constant-time compare of the Signature header against our shared secret. */
function signatureValid(provided: string | null): boolean {
  const secret = getWebhookSecret();
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  // Length must match for timingSafeEqual; compare a fixed-length digestless pair.
  if (a.length !== b.length) {
    // Still do a constant-time compare against itself to avoid early-return timing.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Find proposal-ish objects inside an arbitrary payload, innermost first — so a
 * nested `proposal`/`data` object is tried before the outer webhook envelope
 * (whose own `id` might be an event id, not a proposal uuid). Post-order walk.
 */
function candidateObjects(payload: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== "object" || Array.isArray(v) || seen.has(v) || depth > 3) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const k of ["proposal", "data", "object", "payload", "record", "entity", "customer"]) {
      if (o[k] && typeof o[k] === "object") visit(o[k], depth + 1);
    }
    out.push(o); // self after children → innermost candidates first
  };
  visit(payload, 0);
  return out;
}

/** Pull a proposal uuid out of anywhere obvious in the payload (for enrichment). */
function findProposalUuid(objs: Record<string, unknown>[]): string | null {
  for (const o of objs) {
    for (const k of ["uuid", "id", "proposal_uuid", "proposalId", "proposal_id"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return null;
}

/** Detect a human-readable event/type label if one is present. */
function detectType(payload: unknown): string | null {
  const o = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  if (!o) return null;
  for (const k of ["event", "type", "event_type", "action", "trigger", "name"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.slice(0, 120);
  }
  return null;
}

export async function POST(req: Request) {
  // Read the EXACT raw body first so we can persist it verbatim.
  const rawBody = await req.text().catch(() => "");

  // Verify the shared-secret Signature header (constant-time). 503 if unconfigured.
  if (!webhookSecretConfigured()) {
    return NextResponse.json({ error: "SmarterLaunch webhook is not configured (SMARTERLAUNCH_WEBHOOK_SECRET unset)." }, { status: 503 });
  }
  if (!signatureValid(req.headers.get("signature"))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  // Persist the raw event up front (defensive: parse comes after it's saved).
  let type: string | null = null;
  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
    type = detectType(payload);
  } catch {
    // keep payload null; raw is still stored
  }

  const event = await prisma.smarterLaunchEvent
    .create({ data: { raw: rawBody.slice(0, 100_000), type, parsedOk: false } })
    .catch(() => null);

  // Parse + upsert leniently. Any failure is captured on the event, never thrown.
  let leadId: string | null = null;
  let parsedOk = false;
  let errorMsg: string | null = null;
  try {
    if (!payload || typeof payload !== "object") throw new Error("Payload was not JSON.");
    const objs = candidateObjects(payload);

    // First normalizable candidate wins.
    let norm: NormalizedLead | null = null;
    for (const o of objs) {
      norm = normalizeProposal(o);
      if (norm) break;
    }
    const proposalUuid = norm?.externalId ?? findProposalUuid(objs);
    if (!proposalUuid) throw new Error("No proposal uuid found in payload.");

    // Enrich with ONE quota-aware client call when details are thin — best-effort.
    const needsDetail = !norm || norm.value === 0 || norm.lat == null || norm.lng == null || !norm.proposalStatus;
    if (needsDetail && smarterLaunchConfigured() && (await hasBudget())) {
      try {
        const detail = await fetchProposal(proposalUuid);
        if (detail) {
          const enriched = normalizeProposal(detail);
          if (enriched) norm = enriched;
        }
      } catch {
        // enrichment is optional — fall back to whatever the webhook gave us
      }
    }

    if (!norm) throw new Error("Proposal could not be normalized.");
    const maps = await loadAdvisorMaps();
    leadId = await upsertLead(norm, maps);
    parsedOk = true;
  } catch (e) {
    errorMsg = (e instanceof Error ? e.message : "parse error").slice(0, 300);
  }

  if (event) {
    await prisma.smarterLaunchEvent
      .update({ where: { id: event.id }, data: { parsedOk, leadId, error: errorMsg } })
      .catch(() => {});
  }

  // Always 200 fast so SmarterLaunch doesn't retry a stored event.
  return NextResponse.json({ ok: true, parsed: parsedOk, leadId });
}
