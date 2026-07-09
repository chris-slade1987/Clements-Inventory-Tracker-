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

/** Map an arbitrary category string to one of the fixed tags. */
export function normalizeCategory(raw: string | null | undefined): string {
  const v = (raw ?? "").toLowerCase().trim();
  if (!v) return "Other";
  if (/(term)/.test(v)) return "Termite";
  if (/(rodent|mouse|mice|rat|bait block|blox)/.test(v)) return "Rodent";
  if (/(lawn|turf|herbicide|weed|fertil)/.test(v)) return "Lawn";
  if (/(general|insect|ant|roach|cockroach|pest|dust|igr|bait)/.test(v))
    return "General Pest";
  // Exact match against the canonical list wins.
  const exact = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === v);
  return exact ?? "Other";
}
