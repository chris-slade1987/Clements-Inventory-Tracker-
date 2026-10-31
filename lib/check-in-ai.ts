import "server-only";
import { aiModel } from "@/lib/ai-model";
import { uomCode, UOM_CODES } from "@/lib/uom";

// Conversational assistant for the Check-In review screen. The manager is
// reviewing a distributor-invoice draft (header + editable line list) BEFORE
// pressing Confirm. They describe corrections in plain English ("the 3rd line is
// Termidor SC, qty is 4 cases", "drop the freight line", "put this in Stuart")
// and Claude returns a revised draft the client applies to its editable state.
//
// HARD RULE: this NEVER posts stock. It only revises the draft. On-hand changes
// solely through POST /api/check-in/confirm, which the manager still triggers by
// clicking Confirm. Degrades to a helpful no-op reply when no API key is set.

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type DraftLine = {
  descriptionRaw: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  // Optional catalog product id, only when the client/AI already knows it. The
  // client re-runs product matching after applying, so this is a hint, not law.
  productId?: string | null;
};

export type CheckInDraftState = {
  warehouseId?: string | null;
  distributor?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  lines: DraftLine[];
};

export type WarehouseOpt = { id: string; name: string };
export type CheckInChatResult = { reply: string; draft: CheckInDraftState | null; ai: boolean };

export function hasCheckInChatKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Clamp a draft returned by the model into the shape the client expects. */
function sanitizeDraft(raw: unknown, warehouses: WarehouseOpt[]): CheckInDraftState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rawLines = Array.isArray(o.lines) ? o.lines : null;
  if (!rawLines) return null; // a draft must carry the full line set
  const lines: DraftLine[] = rawLines.map((l) => {
    const r = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    return {
      descriptionRaw: String(r.descriptionRaw ?? r.description ?? "").trim(),
      quantity: num(r.quantity) ?? 0,
      unit: uomCode(r.unit == null ? null : String(r.unit)),
      unitPrice: num(r.unitPrice),
      lineTotal: num(r.lineTotal),
      productId: r.productId == null || String(r.productId).trim() === "" ? null : String(r.productId).trim(),
    };
  });
  const wh = o.warehouseId == null ? null : String(o.warehouseId).trim();
  const warehouseId = wh && warehouses.some((w) => w.id === wh) ? wh : null;
  return {
    warehouseId,
    distributor: o.distributor == null ? null : String(o.distributor),
    invoiceNumber: o.invoiceNumber == null ? null : String(o.invoiceNumber),
    invoiceDate: o.invoiceDate == null ? null : String(o.invoiceDate),
    lines,
  };
}

function system(warehouses: WarehouseOpt[]): string {
  return `You are the Check-In assistant for a pest-control company's warehouse portal. A manager is reviewing a DRAFT of a distributor invoice before receiving the products into stock. They will describe corrections in plain English; you revise the draft and hand it back. You do NOT receive anything into inventory — the manager still presses Confirm on the screen, which is the only thing that posts stock. Never claim you checked anything in.

Warehouses (receive the stock into one of these; map a name/city the manager says to its id):
${warehouses.map((w) => `- ${w.id}: ${w.name}`).join("\n")}

Canonical unit-of-measure CODES (use ONLY these for "unit"): ${UOM_CODES.join(", ")}.
- C = Case, EA = Each, J = Jug, B = Bottle, LB = Pound, OZ = Ounce, PT = Pint, QT = Quart, G3 = 2.5 Gallon, FB = Granular Bag, F2 = 50 Pound Bag. Pick the closest code; when unsure use EA.

Rules:
- Return the FULL revised line list every time you change the draft (not just the changed rows), preserving lines the manager didn't mention.
- To drop a line, omit it. To add one, include it. Reorder only if asked.
- Set "descriptionRaw" to the product/line text; the portal re-matches it to the catalog, so you do NOT choose product ids. Leave product identity to the manager's review.
- Quantities and prices are plain numbers (no symbols). Dates are ISO yyyy-mm-dd.
- If the manager only asks a question or you need clarification, set "draft" to null and just reply.

Respond with ONLY a JSON object, no prose or code fences:
{
  "reply": string,            // 1-3 sentences, plain and direct, confirming what you changed
  "draft": null | {
    "warehouseId": string | null,
    "distributor": string | null,
    "invoiceNumber": string | null,
    "invoiceDate": string | null,   // ISO yyyy-mm-dd
    "lines": [ { "descriptionRaw": string, "quantity": number, "unit": string, "unitPrice": number | null, "lineTotal": number | null } ]
  }
}`;
}

function draftContext(draft: CheckInDraftState, warehouses: WarehouseOpt[]): string {
  const whName = draft.warehouseId ? warehouses.find((w) => w.id === draft.warehouseId)?.name ?? draft.warehouseId : "(none selected)";
  const header = [
    `Warehouse: ${whName}`,
    `Distributor: ${draft.distributor ?? "(blank)"}`,
    `Invoice #: ${draft.invoiceNumber ?? "(blank)"}`,
    `Invoice date: ${draft.invoiceDate ?? "(blank)"}`,
  ].join("\n");
  const lines = draft.lines.length
    ? draft.lines
        .map((l, i) => `${i + 1}. ${l.descriptionRaw || "(no description)"} — qty ${l.quantity} ${l.unit ?? "EA"}${l.unitPrice != null ? ` @ ${l.unitPrice}` : ""}`)
        .join("\n")
    : "(no lines yet)";
  return `Current draft:\n${header}\n\nLines:\n${lines}`;
}

async function callClaude(
  draft: CheckInDraftState,
  warehouses: WarehouseOpt[],
  history: ChatTurn[],
  userMessage: string
): Promise<CheckInChatResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = aiModel.smart();
  const context = draftContext(draft, warehouses);
  const messages = [
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: `${context}\n\n---\nManager: ${userMessage}` },
  ];
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1500, system: system(warehouses), messages }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
    const raw = parseJson(text);
    if (!raw) return null;
    const reply = String(raw.reply ?? "").trim() || "Done — review the lines below.";
    const draftOut = sanitizeDraft(raw.draft, warehouses);
    return { reply, draft: draftOut, ai: true };
  } catch {
    return null;
  }
}

/** Revise the Check-In draft from a manager's instruction. */
export async function checkInChat(
  draft: CheckInDraftState,
  warehouses: WarehouseOpt[],
  history: ChatTurn[],
  userMessage: string
): Promise<CheckInChatResult> {
  const ai = await callClaude(draft, warehouses, history, userMessage);
  if (ai) return ai;
  // Deterministic fallback: no key, so we can't auto-edit. Be explicit and leave
  // the draft untouched so the manager edits the lines by hand.
  return {
    reply:
      "I can't auto-edit the draft without the AI assistant configured (ANTHROPIC_API_KEY). Based on your note, make the change directly on the lines below — pick the product, fix the quantity or unit, set the warehouse, or remove a line — then press Confirm.",
    draft: null,
    ai: false,
  };
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
