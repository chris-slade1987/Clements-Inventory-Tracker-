import type { ParsedInvoice, ParsedLine } from "./types";

const EXTRACT_PROMPT = `You are reading a distributor invoice for a pest-control company. Extract the invoice into JSON with EXACTLY this shape and nothing else:

{
  "invoice_number": string | null,
  "invoice_date": string | null,   // ISO yyyy-mm-dd
  "distributor": string | null,
  "subtotal": number | null,
  "total": number | null,
  "lines": [
    { "description": string, "quantity": number, "unit": string | null, "unit_price": number | null, "line_total": number | null }
  ]
}

Rules:
- Only include real product line items (skip tax, freight, and subtotal rows).
- quantity and prices are numbers (no currency symbols).
- If a field is unknown, use null.
- Respond with ONLY the JSON object, no prose, no code fences.`;

type Block =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };

/**
 * Parse an invoice with Claude vision. `mime` decides whether we send a PDF
 * document block (multi-page supported by the API) or an image block.
 * Throws on network / API / parse failure; the caller falls back to mock.
 */
export async function claudeParse(
  base64: string,
  mime: string
): Promise<ParsedInvoice> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  const fileBlock: Block =
    mime === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: mime, data: base64 },
        };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      messages: [
        { role: "user", content: [fileBlock, { type: "text", text: EXTRACT_PROMPT }] },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
  return normalize(extractJson(text));
}

function extractJson(text: string): Record<string, unknown> {
  // Tolerate stray prose or code fences around the JSON object.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");
  return JSON.parse(candidate.slice(start, end + 1));
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function normalize(raw: Record<string, unknown>): ParsedInvoice {
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  const lines: ParsedLine[] = rawLines.map((l) => {
    const o = l as Record<string, unknown>;
    return {
      description: String(o.description ?? "").trim(),
      quantity: num(o.quantity) ?? 0,
      unit: o.unit != null ? String(o.unit) : null,
      unitPrice: num(o.unit_price),
      lineTotal: num(o.line_total),
    };
  });
  return {
    invoiceNumber: raw.invoice_number != null ? String(raw.invoice_number) : null,
    invoiceDate: raw.invoice_date != null ? String(raw.invoice_date) : null,
    distributor: raw.distributor != null ? String(raw.distributor) : null,
    subtotal: num(raw.subtotal),
    total: num(raw.total),
    lines,
    source: "claude",
  };
}
