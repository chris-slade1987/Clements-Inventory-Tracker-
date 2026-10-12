import "server-only";
import { prisma } from "@/lib/prisma";
import { uomLabel } from "@/lib/uom";

// AI product identification for the scan-to-issue check-out flow. The manager
// photographs a product on the shelf; Claude vision ranks the most likely
// catalog matches so the UI can preselect (high confidence) or offer a top-3.
//
// HARD RULE: this NEVER posts stock and NEVER auto-submits. It only proposes
// which catalog product the photo shows; the manager still confirms the line and
// submits the check-out. Degrades gracefully to a "use catalog search" fallback
// when ANTHROPIC_API_KEY is unset or the call fails/times out.

export type CatalogEntry = {
  id: string;
  name: string;
  distributorSku: string | null;
  unit: string; // canonical UoM code
};

export type IdentifyCandidate = {
  productId: string;
  confidence: number; // 0..1
  reason: string;
};

export type IdentifyResult = {
  ai: boolean;
  candidates: IdentifyCandidate[]; // ranked, best first (≤3)
  labelText: string | null;
  // High-confidence single match the UI may preselect (confidence ≥ 0.85).
  preselectProductId: string | null;
  status: string; // "ok" | "no_key" | "timeout" | "error" | "no_match"
  latencyMs: number;
  message?: string;
};

export type LastIdentify = {
  status: string;
  latencyMs: number;
  topMatch: { productId: string; name: string; confidence: number } | null;
  at: string;
};

const LAST_IDENTIFY_SETTING = "inventory_last_identify";
const IDENTIFY_TIMEOUT_MS = 10_000;

// Module-level cache (per serverless instance) — a fast read for diagnostics on
// the same instance; the Setting below makes it durable across instances.
let lastIdentify: LastIdentify | null = null;

export function hasIdentifyKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Record the most recent identify result for the admin diagnostics endpoint. */
async function recordLastIdentify(entry: LastIdentify): Promise<void> {
  lastIdentify = entry;
  try {
    await prisma.setting.upsert({
      where: { key: LAST_IDENTIFY_SETTING },
      update: { value: JSON.stringify(entry) },
      create: { key: LAST_IDENTIFY_SETTING, value: JSON.stringify(entry) },
    });
  } catch {
    /* best-effort diagnostics only */
  }
}

/** Read the last identify result (module cache first, then the Setting store). */
export async function getLastIdentify(): Promise<LastIdentify | null> {
  if (lastIdentify) return lastIdentify;
  try {
    const row = await prisma.setting.findUnique({ where: { key: LAST_IDENTIFY_SETTING } });
    if (row) return JSON.parse(row.value) as LastIdentify;
  } catch {
    /* ignore */
  }
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function systemPrompt(catalog: CatalogEntry[]): string {
  const list = catalog
    .map((c) => `- ${c.id}: ${c.name}${c.distributorSku ? ` (SKU ${c.distributorSku})` : ""} [${uomLabel(c.unit)}]`)
    .join("\n");
  return `You identify a pest-control product from a photo so a warehouse manager can check it out to a technician. You are given a photo of ONE product (a chemical jug/bottle/bag/can/box or a device) and the branch's active catalog. Decide which catalog product the photo most likely shows.

Active catalog (id: name (SKU) [unit]):
${list}

Rules:
- Only choose from the catalog ids above. NEVER invent an id.
- Return the TOP 3 most likely matches, best first, each with a confidence 0..1 and a short reason (what on the label drove the match: brand, active ingredient, size).
- If nothing in the catalog plausibly matches, return an empty "candidates" array.
- Also return any readable product/label text you can see ("labelText"), to help the manager search by hand.

Respond with ONLY a JSON object, no prose or code fences:
{
  "candidates": [ { "productId": string, "confidence": number, "reason": string } ],
  "labelText": string | null
}`;
}

/**
 * Identify a product from a base64 JPEG against the active catalog. `mime` is the
 * image media type (default image/jpeg). Always resolves — on no key, timeout, or
 * error it returns an ai:false fallback telling the UI to use catalog search.
 */
export async function identifyProduct(
  base64: string,
  mime: string,
  catalog: CatalogEntry[],
): Promise<IdentifyResult> {
  const started = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const byId = new Map(catalog.map((c) => [c.id, c]));

  if (!apiKey) {
    const res: IdentifyResult = {
      ai: false,
      candidates: [],
      labelText: null,
      preselectProductId: null,
      status: "no_key",
      latencyMs: 0,
      message: "AI identification isn't configured — search the catalog instead.",
    };
    await recordLastIdentify({ status: "no_key", latencyMs: 0, topMatch: null, at: new Date().toISOString() });
    return res;
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTIFY_TIMEOUT_MS);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 800,
        system: systemPrompt(catalog),
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data: base64 } },
              { type: "text", text: "Identify this product from the catalog above." },
            ],
          },
        ],
      }),
    });
    clearTimeout(timer);

    if (!r.ok) {
      const latencyMs = Date.now() - started;
      await recordLastIdentify({ status: `error_${r.status}`, latencyMs, topMatch: null, at: new Date().toISOString() });
      return {
        ai: false,
        candidates: [],
        labelText: null,
        preselectProductId: null,
        status: "error",
        latencyMs,
        message: "Identification failed — search the catalog instead.",
      };
    }

    const data = (await r.json()) as { content?: { text?: string }[] };
    const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
    const raw = parseJson(text);
    const latencyMs = Date.now() - started;

    const rawCandidates = raw && Array.isArray(raw.candidates) ? raw.candidates : [];
    const candidates: IdentifyCandidate[] = rawCandidates
      .map((c) => {
        const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
        const productId = String(o.productId ?? "").trim();
        const confidence = Math.max(0, Math.min(1, num(o.confidence) ?? 0));
        return { productId, confidence, reason: String(o.reason ?? "").trim() };
      })
      .filter((c) => c.productId && byId.has(c.productId))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    const labelText = raw && raw.labelText != null ? String(raw.labelText).trim() || null : null;
    const top = candidates[0] ?? null;
    const preselectProductId = top && top.confidence >= 0.85 ? top.productId : null;
    const status = candidates.length ? "ok" : "no_match";

    await recordLastIdentify({
      status,
      latencyMs,
      topMatch: top ? { productId: top.productId, name: byId.get(top.productId)?.name ?? "", confidence: top.confidence } : null,
      at: new Date().toISOString(),
    });

    return {
      ai: true,
      candidates,
      labelText,
      preselectProductId,
      status,
      latencyMs,
      message: candidates.length ? undefined : "No confident match — search the catalog instead.",
    };
  } catch (e) {
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    const aborted = (e as Error)?.name === "AbortError";
    const status = aborted ? "timeout" : "error";
    await recordLastIdentify({ status, latencyMs, topMatch: null, at: new Date().toISOString() });
    return {
      ai: false,
      candidates: [],
      labelText: null,
      preselectProductId: null,
      status,
      latencyMs,
      message: aborted
        ? "Identification timed out — search the catalog instead."
        : "Identification failed — search the catalog instead.",
    };
  }
}
