// Maintenance-invoice reader for the Fleet center. Mirrors the Check-In
// invoice reader, but tuned for mechanic invoices / monthly shop statements:
// it pulls per-line charges and tries to identify which vehicle each charge
// belongs to (a shop statement often bills several trucks on one document).

import { SERVICE_TYPES } from "@/lib/fleet";

export type MaintLine = {
  description: string;
  serviceType: string; // one of SERVICE_TYPES keys
  cost: number | null;
  mileage: number | null;
  /** Raw vehicle identifier the reader saw on the line (truck #, plate, VIN, "2021 Frontier"). */
  vehicleHint: string | null;
};

export type MaintInvoice = {
  vendor: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // ISO yyyy-mm-dd
  lines: MaintLine[];
  source: "mock" | "claude";
};

/** Minimal vehicle shape needed to match a hint to a record. */
export type MatchVehicle = {
  id: string;
  unitNumber: string | null;
  name: string;
  plate: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
};

const SERVICE_KEYS = new Set<string>(SERVICE_TYPES.map((t) => t.key));

function normServiceType(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (SERVICE_KEYS.has(s)) return s;
  if (/oil/.test(s)) return "oil_change";
  if (/tire|wheel|align/.test(s)) return "tires";
  if (/inspect/.test(s)) return "inspection";
  if (/pm|prevent|scheduled|maint/.test(s)) return "pm";
  if (/repair|replace|brake|engine|transmission|fix/.test(s)) return "repair";
  return "other";
}

/**
 * Match a free-text vehicle hint to one of the fleet vehicles.
 * Tries, in order: plate, VIN (full or last 6), unit number, then make/model text.
 * Returns the vehicle id or null when there's no confident match.
 */
export function matchVehicle(hint: string | null, vehicles: MatchVehicle[]): string | null {
  const raw = (hint ?? "").trim();
  if (!raw) return null;
  const up = raw.toUpperCase();
  const alnum = up.replace(/[^A-Z0-9]/g, "");

  // Plate (normalize away spaces/dashes).
  for (const v of vehicles) {
    if (v.plate && v.plate.toUpperCase().replace(/[^A-Z0-9]/g, "") === alnum) return v.id;
  }
  // VIN — full match or shared last-6 (shops often write only the last 6).
  for (const v of vehicles) {
    if (!v.vin) continue;
    const vin = v.vin.toUpperCase();
    if (vin === up || (alnum.length >= 6 && (vin.includes(alnum) || alnum.includes(vin.slice(-6))))) return v.id;
  }
  // Unit / truck number — pull the number out of "Truck #12", "Unit 12", "#12", "12".
  const numMatch = up.match(/(?:TRUCK|UNIT|VEH(?:ICLE)?|#)\s*#?\s*(\d{1,4})/) ?? up.match(/^#?(\d{1,4})$/);
  if (numMatch) {
    const n = String(parseInt(numMatch[1], 10));
    for (const v of vehicles) if (v.unitNumber && String(parseInt(v.unitNumber, 10)) === n) return v.id;
  }
  // Make/model text (e.g. "2021 Nissan Frontier", "F-250").
  const hay = up;
  let best: { id: string; score: number } | null = null;
  for (const v of vehicles) {
    const make = (v.make ?? "").toUpperCase();
    const model = (v.model ?? "").toUpperCase();
    let score = 0;
    if (make && hay.includes(make)) score += 1;
    if (model && hay.includes(model.replace(/[^A-Z0-9]/g, ""))) score += 2;
    else if (model && hay.replace(/[^A-Z0-9]/g, "").includes(model.replace(/[^A-Z0-9]/g, ""))) score += 2;
    if (score > 0 && (!best || score > best.score)) best = { id: v.id, score };
  }
  return best && best.score >= 2 ? best.id : null;
}

const EXTRACT_PROMPT = `You are reading a vehicle maintenance / repair invoice or a monthly shop statement for a pest-control company's truck fleet. A single document may bill work on SEVERAL different vehicles. Extract it into JSON with EXACTLY this shape and nothing else:

{
  "vendor": string | null,           // the shop / mechanic / vendor name
  "invoice_number": string | null,
  "invoice_date": string | null,     // ISO yyyy-mm-dd
  "lines": [
    {
      "description": string,          // what was done (e.g. "Oil change + filter")
      "service_type": string,         // one of: oil_change, pm, repair, tires, inspection, other
      "cost": number | null,          // the charge for this line, no currency symbols
      "mileage": number | null,       // odometer reading if shown, else null
      "vehicle_hint": string | null   // ANY identifier tying the line to a vehicle: truck/unit number, license plate, VIN, or year/make/model. null if none.
    }
  ]
}

Rules:
- Create one line per distinct charge. If the statement groups charges under a vehicle heading, repeat that vehicle's identifier in every line's vehicle_hint.
- Skip tax, shop-supply fees, and total rows unless they are the only charge.
- Numbers only for cost and mileage (no $ or commas).
- If a field is unknown, use null.
- Respond with ONLY the JSON object, no prose, no code fences.`;

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalize(raw: Record<string, unknown>, source: "claude" | "mock"): MaintInvoice {
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  const lines: MaintLine[] = rawLines.map((l) => {
    const o = l as Record<string, unknown>;
    return {
      description: String(o.description ?? "").trim() || "Service",
      serviceType: normServiceType(o.service_type),
      cost: num(o.cost),
      mileage: num(o.mileage),
      vehicleHint: o.vehicle_hint != null && String(o.vehicle_hint).trim() !== "" ? String(o.vehicle_hint).trim() : null,
    };
  });
  return {
    vendor: raw.vendor != null ? String(raw.vendor) : null,
    invoiceNumber: raw.invoice_number != null ? String(raw.invoice_number) : null,
    invoiceDate: raw.invoice_date != null ? String(raw.invoice_date) : null,
    lines,
    source,
  };
}

export function maintReaderMode(): "claude" | "mock" {
  return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
}

async function claudeParse(base64: string, mime: string): Promise<MaintInvoice> {
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
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: EXTRACT_PROMPT }] }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
  return normalize(extractJson(text), "claude");
}

/** Deterministic sample used when no API key is configured, so the flow always demos. */
function mockParse(): MaintInvoice {
  return {
    vendor: "Sample Auto Service",
    invoiceNumber: "DEMO-1001",
    invoiceDate: new Date().toISOString().slice(0, 10),
    source: "mock",
    lines: [
      { description: "Full synthetic oil change + filter", serviceType: "oil_change", cost: 89.95, mileage: null, vehicleHint: "Truck 1" },
      { description: "Front brake pads & rotors", serviceType: "repair", cost: 412.5, mileage: null, vehicleHint: "Truck 6" },
      { description: "4-tire replacement + alignment", serviceType: "tires", cost: 764.0, mileage: null, vehicleHint: "Truck 6" },
    ],
  };
}

export async function parseMaintenance(base64: string, mime: string): Promise<MaintInvoice> {
  if (!process.env.ANTHROPIC_API_KEY) return mockParse();
  return claudeParse(base64, mime);
}
