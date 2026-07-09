// Shared shapes for the invoice reader (Check-In).

export type ParsedLine = {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
};

export type ParsedInvoice = {
  invoiceNumber: string | null;
  invoiceDate: string | null; // ISO (yyyy-mm-dd) if known
  distributor: string | null;
  subtotal: number | null;
  total: number | null;
  lines: ParsedLine[];
  /** "mock" or "claude" — surfaced in the UI so the user knows the source. */
  source: "mock" | "claude";
};
