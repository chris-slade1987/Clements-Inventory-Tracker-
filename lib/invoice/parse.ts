import type { ParsedInvoice } from "./types";
import { mockParse } from "./mock";
import { claudeParse } from "./anthropic";

export function invoiceReaderMode(): "claude" | "mock" {
  return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
}

/**
 * Parse an invoice file. Uses Claude vision when a key is configured, otherwise
 * the deterministic mock. When a key IS set, API failures propagate so the UI
 * can show a real error (rather than silently returning fake data).
 */
export async function parseInvoice(
  base64: string,
  mime: string
): Promise<ParsedInvoice> {
  if (!process.env.ANTHROPIC_API_KEY) return mockParse();
  return claudeParse(base64, mime);
}
