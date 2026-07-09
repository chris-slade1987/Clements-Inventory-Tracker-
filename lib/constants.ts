// Fixed taxonomies shared across the app.

// Product category tags. Kept as a small fixed set so reporting can break down
// cleanly. Stored on Product.category (a free string) but the UI constrains to
// these, and CSV import maps incoming values to the closest match.
export const PRODUCT_CATEGORIES = [
  "General Pest",
  "Lawn",
  "Rodent",
  "Termite",
  "Other",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// The branches. "Vero Beach (HQ)" keeps its existing name so we don't duplicate
// the record already in production.
export const STANDARD_WAREHOUSES = [
  "Vero Beach (HQ)",
  "Stuart",
  "Orlando",
  "Naples",
];

// Employee profile taxonomies.
export const EMPLOYEE_ROLES = ["Technician", "Manager", "Sales Advisor"] as const;
export const EMPLOYEE_DIVISIONS = ["Lawn", "General Pest", "Service"] as const;

/** Normalize a free role string to one of the canonical roles. */
export function normalizeRole(raw: string | null | undefined): string {
  const v = (raw ?? "").toLowerCase().trim();
  if (/sales|advisor/.test(v)) return "Sales Advisor";
  if (/manager|mgr|supervisor/.test(v)) return "Manager";
  if (/tech/.test(v)) return "Technician";
  const exact = EMPLOYEE_ROLES.find((r) => r.toLowerCase() === v);
  return exact ?? "Technician";
}

/** Normalize a free division string to one of the canonical divisions, or null. */
export function normalizeDivision(raw: string | null | undefined): string | null {
  const v = (raw ?? "").toLowerCase().trim();
  if (!v) return null;
  if (/lawn|turf/.test(v)) return "Lawn";
  if (/general|pest/.test(v)) return "General Pest";
  if (/service/.test(v)) return "Service";
  const exact = EMPLOYEE_DIVISIONS.find((d) => d.toLowerCase() === v);
  return exact ?? null;
}

/**
 * Best-effort mapping of a product name/category string to one of the fixed
 * tags. Ordered so the most specific signal wins. Imported data is only a
 * starting point — categories can be corrected in Manage afterwards.
 */
export function normalizeCategory(raw: string | null | undefined): string {
  const v = (raw ?? "").toLowerCase().trim();
  if (!v) return "Other";
  // Exact match against the canonical list wins.
  const exact = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === v);
  if (exact) return exact;
  if (/termidor|termite|termiticide/.test(v)) return "Termite";
  if (/rodent|mouse|mice|\brat\b|snap trap|glue|bait block|bait stat|blox|victor|trapper|catchmaster|eaton|stick-?em|t-rex/.test(v))
    return "Rodent";
  if (/lawn|turf|herbicide|fungicide|fertiliz|fertil|weed|lesco|sedgehammer|spreader|speedzone|avenue|artavia|heritage|phyte|k-flow|macron|granular fert|0-0-|19-19/.test(v))
    return "Lawn";
  if (/insect|ant\b|roach|cockroach|wasp|\bdust\b|aerosol|gel bait|\bigr\b|precor|gentrol|advion|optigard|maxforce|safari|suspend|alpine|bifen|cb-?80|uld|deltadust|extinguish|dipel/.test(v))
    return "General Pest";
  return "Other";
}

// PestPac unit-of-measure codes -> readable unit labels.
export const UOM_LABELS: Record<string, string> = {
  B: "bottle",
  BS: "station",
  J: "jug",
  BU: "pail",
  T: "tube",
  AC: "can",
  FB: "bag",
  C: "case",
  RT: "each",
  PK: "pack",
};

export function unitLabel(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  return UOM_LABELS[c] ?? (c ? c.toLowerCase() : "ea");
}
