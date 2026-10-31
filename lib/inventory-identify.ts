import "server-only";
import { aiModel } from "@/lib/ai-model";
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

// A stored reference photo of a catalog product, passed into identify so the AI
// can compare the submitted shelf photo against real pictures of each product
// (not just its name/SKU text). Kept small + capped by the caller.
export type ReferenceImage = {
  productId: string;
  kind: string; // "product" | "label" | "barcode" | "other"
  base64: string;
  mime: string;
};

// How many reference images we allow into a single identify call. Vision payloads
// grow fast, so we cap the total; products past the cap still get text matching.
export const REFERENCE_IMAGE_CAP = 12;

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

function systemPrompt(catalog: CatalogEntry[], hasReferences: boolean): string {
  const list = catalog
    .map((c) => `- ${c.id}: ${c.name}${c.distributorSku ? ` (SKU ${c.distributorSku})` : ""} [${uomLabel(c.unit)}]`)
    .join("\n");
  return `You identify a pest-control product from a photo so a warehouse manager can check it out to a technician. The FIRST image is the photo to identify (one product: a chemical jug/bottle/bag/can/box or a device). You are also given the branch's active catalog. Decide which catalog product the first photo most likely shows.

Active catalog (id: name (SKU) [unit]):
${list}
${hasReferences ? `
Reference photos: after the first image, you are given stored REFERENCE photos of specific catalog products. Each reference is introduced by a line like "REFERENCE productId=<id> kind=<product|label|barcode>". Compare the first photo against these reference photos — a strong visual match (same bottle shape, label artwork, color, barcode) is the most reliable signal and should raise confidence well above a name-only guess. Products with no reference photo must still be matched on their name/SKU text alone.
` : ""}
Rules:
- Only choose from the catalog ids above. NEVER invent an id.
- Return the TOP 3 most likely matches, best first, each with a confidence 0..1 and a short reason (what drove the match: ${hasReferences ? "reference-photo match, " : ""}brand, active ingredient, size).
- If nothing in the catalog plausibly matches, return an empty "candidates" array.
- Also return any readable product/label text you can see on the FIRST photo ("labelText"), to help the manager search by hand.

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
  references: ReferenceImage[] = [],
): Promise<IdentifyResult> {
  const started = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const refs = references.filter((r) => r.base64 && byId.has(r.productId)).slice(0, REFERENCE_IMAGE_CAP);

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

  const model = aiModel.smart();
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
        system: systemPrompt(catalog, refs.length > 0),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Photo to identify:" },
              { type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data: base64 } },
              ...refs.flatMap((r) => [
                { type: "text" as const, text: `REFERENCE productId=${r.productId} kind=${r.kind}` },
                { type: "image" as const, source: { type: "base64" as const, media_type: r.mime || "image/jpeg", data: r.base64 } },
              ]),
              { type: "text", text: "Identify the first photo against the catalog above." },
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

/** The allowed photo kinds for a product reference photo. */
export const PHOTO_KINDS = ["product", "label", "barcode", "other"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** Shared one-shot Claude vision JSON call. Returns parsed JSON or null on any
 *  failure (no key, timeout, error, unparseable) so callers degrade gracefully. */
async function visionJson(
  base64s: { base64: string; mime: string }[],
  system: string,
  userText: string,
  maxTokens = 500,
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || base64s.length === 0) return null;
  const model = aiModel.smart();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTIFY_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: "user",
            content: [
              ...base64s.map((b) => ({ type: "image" as const, source: { type: "base64" as const, media_type: b.mime || "image/jpeg", data: b.base64 } })),
              { type: "text" as const, text: userText },
            ],
          },
        ],
      }),
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = (await r.json()) as { content?: { text?: string }[] };
    const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
    return parseJson(text);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Auto-classify a single product photo as product | label | barcode, and read any
 * label text. Degrades to { kind: "other", labelText: null } with no key / on
 * failure so the uploader can pick the kind by hand.
 */
export async function classifyPhoto(base64: string, mime: string): Promise<{ kind: PhotoKind; labelText: string | null; ai: boolean }> {
  const raw = await visionJson(
    [{ base64, mime }],
    `You classify ONE photo of a pest-control product for a warehouse catalog. Decide what the photo primarily shows:
- "product": the whole product (jug/bottle/bag/can/box/device).
- "label": a close-up of the product's printed label / front panel.
- "barcode": a close-up of a barcode / UPC.
- "other": anything else or unclear.
Also return any readable product/label text ("labelText").
Respond with ONLY JSON: { "kind": "product"|"label"|"barcode"|"other", "labelText": string | null }`,
    "Classify this photo.",
    300,
  );
  if (!raw) return { kind: "other", labelText: null, ai: false };
  const k = String(raw.kind ?? "").trim().toLowerCase();
  const kind = (PHOTO_KINDS as readonly string[]).includes(k) ? (k as PhotoKind) : "other";
  const labelText = raw.labelText != null ? String(raw.labelText).trim() || null : null;
  return { kind, labelText, ai: true };
}

export type ProductAutofill = {
  name: string | null;
  description: string | null;
  manufacturer: string | null;
  distributorSku: string | null;
  unitOfMeasure: string | null; // free-text UoM hint; caller maps to a canonical code
  division: string | null; // GHP | LO | TERMITE | RODENT | OTHER hint
  ai: boolean;
};

/**
 * Read one or more photos of a NOT-yet-cataloged product and pre-fill the fields
 * a manager would otherwise type by hand (name, description, manufacturer, SKU,
 * unit, line-of-service). Everything is a suggestion the reviewer can correct.
 * Degrades to all-null (ai:false) with no key / on failure.
 */
export async function autofillProduct(images: { base64: string; mime: string }[]): Promise<ProductAutofill> {
  const empty: ProductAutofill = { name: null, description: null, manufacturer: null, distributorSku: null, unitOfMeasure: null, division: null, ai: false };
  const raw = await visionJson(
    images.slice(0, 3),
    `You read photos of a single pest-control product (chemical or device) that a warehouse manager wants added to the catalog. From the label/packaging, extract what you can. Guess conservatively — use null when unsure. Division is the line of service: "GHP" (general/household pest), "LO" (lawn & ornamental / fertilizer), "TERMITE", "RODENT", or "OTHER".
Respond with ONLY JSON:
{ "name": string|null, "description": string|null, "manufacturer": string|null, "distributorSku": string|null, "unitOfMeasure": string|null, "division": "GHP"|"LO"|"TERMITE"|"RODENT"|"OTHER"|null }`,
    "Read this product and fill the fields.",
    600,
  );
  if (!raw) return empty;
  const str = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
  return {
    name: str(raw.name),
    description: str(raw.description),
    manufacturer: str(raw.manufacturer),
    distributorSku: str(raw.distributorSku),
    unitOfMeasure: str(raw.unitOfMeasure),
    division: str(raw.division),
    ai: true,
  };
}
