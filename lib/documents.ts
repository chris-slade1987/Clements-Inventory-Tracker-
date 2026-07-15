import { prisma } from "@/lib/prisma";

// Vehicle document center: upload insurance / registration / title docs, let
// the AI read them and propose where they belong (which vehicle + category),
// then the user confirms. Expiration dates drive renewal reminders to HR.

export const DOC_CATEGORIES = [
  { key: "insurance", label: "Insurance" },
  { key: "registration", label: "Registration" },
  { key: "title", label: "Title" },
  { key: "inspection", label: "Inspection / emissions" },
  { key: "other", label: "Other" },
] as const;

export function categoryLabel(key: string | null): string {
  return DOC_CATEGORIES.find((c) => c.key === key)?.label ?? "Other";
}

export type DocAnalysis = {
  category: string; // best-guess category
  title: string;
  insurer: string | null;
  policyNumber: string | null;
  effectiveDate: string | null; // ISO
  expirationDate: string | null; // ISO
  vehicleHint: string | null; // raw identifier seen (VIN / plate / unit / driver / description)
  driverHint: string | null;
  summary: string; // one/two-sentence plain summary for the confirm screen
  source: "claude" | "mock";
};

export type MatchVehicle = {
  id: string;
  unitNumber: string | null;
  name: string;
  plate: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  assignedTo: string | null;
  branch: string | null;
};

export function documentReaderMode(): "claude" | "mock" {
  return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
}

const EXTRACT_PROMPT = `You are filing a document for a pest-control company's vehicle fleet. Read the document and return JSON with EXACTLY this shape and nothing else:

{
  "category": "insurance" | "registration" | "title" | "inspection" | "other",
  "title": string,                 // short human title, e.g. "Progressive Commercial Auto Policy"
  "insurer": string | null,        // insurer / issuing authority, if any
  "policy_number": string | null,  // policy or document number
  "effective_date": string | null, // ISO yyyy-mm-dd
  "expiration_date": string | null,// ISO yyyy-mm-dd (renewal date)
  "vehicle_hint": string | null,   // any vehicle identifier found: VIN, plate, unit #, or year/make/model
  "driver_hint": string | null,    // driver / insured person name if present
  "summary": string                // 1-2 sentences a manager can read to confirm where it belongs
}

Rules:
- Pick the single best category.
- Prefer a VIN for vehicle_hint when present (copy it exactly).
- Dates as ISO yyyy-mm-dd. Unknown fields => null.
- Respond with ONLY the JSON object — no prose, no code fences.`;

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

/** Read a document with Claude. Throws on failure so the caller can fall back. */
async function claudeAnalyze(base64: string, mime: string): Promise<DocAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const fileBlock: Block =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mime, data: base64 } };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content: [fileBlock, { type: "text", text: EXTRACT_PROMPT }] }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
  const raw = extractJson(text);
  const cat = String(raw.category ?? "other").toLowerCase();
  return {
    category: DOC_CATEGORIES.some((c) => c.key === cat) ? cat : "other",
    title: String(raw.title ?? "Document").trim() || "Document",
    insurer: str(raw.insurer),
    policyNumber: str(raw.policy_number),
    effectiveDate: str(raw.effective_date),
    expirationDate: str(raw.expiration_date),
    vehicleHint: str(raw.vehicle_hint),
    driverHint: str(raw.driver_hint),
    summary: String(raw.summary ?? "").trim(),
    source: "claude",
  };
}

/** Deterministic fallback when no API key is configured. */
function mockAnalyze(fileName: string): DocAnalysis {
  const lower = fileName.toLowerCase();
  const category = /insur|policy|progressive|geico|owners/.test(lower)
    ? "insurance"
    : /regist|tag|plate/.test(lower)
      ? "registration"
      : /title/.test(lower)
        ? "title"
        : "other";
  return {
    category,
    title: fileName.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Document",
    insurer: null,
    policyNumber: null,
    effectiveDate: null,
    expirationDate: null,
    vehicleHint: null,
    driverHint: null,
    summary: "Reader not configured — set ANTHROPIC_API_KEY for automatic reading. Please choose the vehicle and category manually.",
    source: "mock",
  };
}

export async function analyzeDocument(base64: string, mime: string, fileName: string): Promise<DocAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) return mockAnalyze(fileName);
  return claudeAnalyze(base64, mime);
}

/**
 * Match a vehicle from the AI's hints. Tries VIN (exact / last-6), plate, unit
 * number, driver name (against assignedTo), then year/make/model text.
 * Returns { id, confidence } or null.
 */
export function matchDocVehicle(a: Pick<DocAnalysis, "vehicleHint" | "driverHint">, vehicles: MatchVehicle[]): { id: string; confidence: "high" | "medium" } | null {
  const hint = (a.vehicleHint ?? "").toUpperCase();
  const alnum = hint.replace(/[^A-Z0-9]/g, "");

  if (alnum.length >= 6) {
    for (const v of vehicles) {
      if (!v.vin) continue;
      const vin = v.vin.toUpperCase();
      if (vin === hint || vin.replace(/[^A-Z0-9]/g, "") === alnum) return { id: v.id, confidence: "high" };
    }
    for (const v of vehicles) {
      if (v.vin && (v.vin.toUpperCase().includes(alnum) || alnum.includes(v.vin.toUpperCase().slice(-6)))) return { id: v.id, confidence: "high" };
    }
  }
  // Plate
  for (const v of vehicles) {
    if (v.plate && alnum && v.plate.toUpperCase().replace(/[^A-Z0-9]/g, "") === alnum) return { id: v.id, confidence: "high" };
  }
  // Unit number ("#8", "Unit 8", "Truck 8")
  const um = hint.match(/(?:TRUCK|UNIT|VEH(?:ICLE)?|#)\s*#?\s*(\d{1,4})/) ?? hint.match(/^#?(\d{1,4})$/);
  if (um) {
    const n = String(parseInt(um[1], 10));
    for (const v of vehicles) if (v.unitNumber && String(parseInt(v.unitNumber, 10)) === n) return { id: v.id, confidence: "medium" };
  }
  // Driver name against assignedTo (e.g. "Samuel Kimble-Dixon" → "Sam").
  const driver = (a.driverHint ?? "").toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (driver) {
    const first = driver.split(/\s+/)[0];
    for (const v of vehicles) {
      const at = (v.assignedTo ?? "").toLowerCase().replace(/[^a-z\s]/g, "").trim();
      if (!at) continue;
      if (at === driver || at === first || driver.startsWith(at) || at.startsWith(first)) return { id: v.id, confidence: "medium" };
    }
  }
  // Year/make/model text.
  if (hint) {
    for (const v of vehicles) {
      const make = (v.make ?? "").toUpperCase();
      const model = (v.model ?? "").toUpperCase();
      if (make && model && hint.includes(make) && hint.includes(model)) return { id: v.id, confidence: "medium" };
    }
  }
  return null;
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");
  return JSON.parse(candidate.slice(start, end + 1));
}
function str(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" || s.toLowerCase() === "null" ? null : s;
}

// ---- queries --------------------------------------------------------------
export async function docsForVehicle(vehicleId: string) {
  return prisma.vehicleDocument.findMany({ where: { vehicleId, status: "filed" }, orderBy: [{ category: "asc" }, { createdAt: "desc" }] });
}
export async function pendingDocs() {
  return prisma.vehicleDocument.findMany({ where: { status: "pending" }, orderBy: { createdAt: "desc" }, include: { vehicle: { select: { unitNumber: true, name: true } } } });
}
export async function recentFiledDocs(limit = 20) {
  return prisma.vehicleDocument.findMany({ where: { status: "filed" }, orderBy: { createdAt: "desc" }, take: limit, include: { vehicle: { select: { unitNumber: true, name: true, branch: true } } } });
}
/** Filed docs with a renewal date within `days` (or already past). */
export async function expiringDocs(days = 45) {
  const cutoff = new Date(Date.now() + days * 864e5);
  return prisma.vehicleDocument.findMany({
    where: { status: "filed", expirationDate: { not: null, lte: cutoff } },
    orderBy: { expirationDate: "asc" },
    include: { vehicle: { select: { unitNumber: true, name: true, branch: true } } },
  });
}
