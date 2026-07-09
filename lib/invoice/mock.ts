import type { ParsedInvoice } from "./types";

/**
 * Deterministic sample invoice used when ANTHROPIC_API_KEY is not set, so the
 * whole Check-In flow demos without a key. The line descriptions intentionally
 * differ from the catalog names (e.g. "Talstar Pro Gallon") to exercise fuzzy
 * matching, and one line ("Nyguard IGR") has no catalog match to exercise the
 * create/pick-product step.
 */
export function mockParse(): ParsedInvoice {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    { description: "Termidor SC 20 oz", quantity: 6, unit: "ea", unitPrice: 92.75, lineTotal: 556.5 },
    { description: "Talstar Pro Gallon", quantity: 8, unit: "ea", unitPrice: 63.5, lineTotal: 508.0 },
    { description: "Advion Roach Gel Bait Box", quantity: 12, unit: "ea", unitPrice: 34.25, lineTotal: 411.0 },
    { description: "Nyguard IGR Concentrate 1 pt", quantity: 4, unit: "ea", unitPrice: 210.0, lineTotal: 840.0 },
  ];
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return {
    invoiceNumber: "SO-105993",
    invoiceDate: today,
    distributor: "SiteOne",
    subtotal,
    total: subtotal,
    lines,
    source: "mock",
  };
}
