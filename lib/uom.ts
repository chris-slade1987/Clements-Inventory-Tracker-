// Canonical unit-of-measure governance.
//
// This is the SINGLE SOURCE OF TRUTH for every unit dropdown in the app. The
// codes are the CEO's authoritative PestPac UoM table. The value stored on a
// Product (Product.unitOfMeasure) and on a movement (StockMovement.unit) is
// ALWAYS one of these codes — never free text. UI never lets a manager type a
// unit; they pick from UNITS_OF_MEASURE.

export type UnitOfMeasure = { code: string; label: string };

// Ordered exactly as the authoritative PestPac table (21 codes).
export const UNITS_OF_MEASURE: UnitOfMeasure[] = [
  { code: "AC", label: "Aerosol Can" },
  { code: "B", label: "Bottle" },
  { code: "BS", label: "Bait Station" },
  { code: "BU", label: "Bucket" },
  { code: "C", label: "Case" },
  { code: "FB", label: "Granular Bag" },
  { code: "FL", label: "Fluid Ounce" },
  { code: "G", label: "Grams" },
  { code: "J", label: "Jug" },
  { code: "LB", label: "Pound" },
  { code: "LI", label: "Liter" },
  { code: "OZ", label: "Ounce" },
  { code: "P", label: "Pallet" },
  { code: "PK", label: "Packet" },
  { code: "PT", label: "Pint" },
  { code: "QT", label: "Quart" },
  { code: "RT", label: "Rodent Trap" },
  { code: "T", label: "Prepackaged Tube" },
  { code: "EA", label: "Each" },
  { code: "F2", label: "50 Pound Bag" },
  { code: "G3", label: "2.5 Gallon" },
];

/** Lookup by canonical code. */
export const UOM_BY_CODE: Map<string, UnitOfMeasure> = new Map(
  UNITS_OF_MEASURE.map((u) => [u.code, u])
);

/** The ordered canonical code list. */
export const UOM_CODES: string[] = UNITS_OF_MEASURE.map((u) => u.code);

/** Human label for a canonical code (falls back to the raw value). */
export function uomLabel(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  return UOM_BY_CODE.get(c)?.label ?? (c || "");
}

/** True when `code` is one of the canonical codes. */
export function isUomCode(code: string | null | undefined): boolean {
  return UOM_BY_CODE.has((code ?? "").trim().toUpperCase());
}

// Legacy free-text unit labels found on pre-governance catalog rows, mapped to
// the closest canonical code so those products still preselect a sensible
// option in the dropdown. New data is always a canonical code, so this is only
// a migration nicety.
const LEGACY_TO_CODE: Record<string, string> = {
  bottle: "B",
  jug: "J",
  case: "C",
  pail: "BU",
  bucket: "BU",
  tube: "T",
  can: "AC",
  "aerosol can": "AC",
  bag: "FB",
  "granular bag": "FB",
  station: "BS",
  "bait station": "BS",
  trap: "RT",
  "rodent trap": "RT",
  pack: "PK",
  packet: "PK",
  oz: "OZ",
  ounce: "OZ",
  "fluid ounce": "FL",
  lb: "LB",
  pound: "LB",
  g: "G",
  gram: "G",
  grams: "G",
  gallon: "J",
  gal: "J",
  box: "PK",
  each: "EA",
  ea: "EA",
  pint: "PT",
  quart: "QT",
  liter: "LI",
  pallet: "P",
};

/**
 * Resolve any stored unit value to a canonical code. Returns the code when the
 * value already is one (or a known legacy label), otherwise null so the UI can
 * fall back to an empty "pick a unit" state rather than inventing a value.
 */
export function uomCode(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const up = raw.toUpperCase();
  if (UOM_BY_CODE.has(up)) return up;
  return LEGACY_TO_CODE[raw.toLowerCase()] ?? null;
}

/**
 * Case -> unit conversion hook. Some products are received by the case (C) but
 * dispersed by the unit (e.g. tube, T). The pack size lives on
 * Product.unitsPerCase and is filled in a LATER step (pack sizes TBD), so no
 * conversion runs yet. When it lands, all case/unit math belongs here so there
 * is one place to change. Returns null until a pack size is known.
 */
export function unitsFromCases(
  cases: number,
  unitsPerCase: number | null | undefined
): number | null {
  if (!unitsPerCase || unitsPerCase <= 0) return null;
  return cases * unitsPerCase;
}
