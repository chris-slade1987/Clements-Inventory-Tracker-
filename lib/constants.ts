// Fixed taxonomies shared across the app.

// Product category tags. Kept as a small fixed set so reporting can break down
// cleanly. Stored on Product.category (a free string) but the UI constrains to
// these, and CSV import maps incoming values to the closest match.
export const PRODUCT_CATEGORIES = [
  "Insecticide/Pesticide",
  "Herbicide",
  "Fungicide",
  "Liquid Fertilizer",
  "Granular Fertilizer",
  "Termiticide",
  "Rodent",
  "Other",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Line-of-service (division / subdivision) taxonomy. ADDITIVE to PRODUCT_CATEGORIES
// above: `category` describes the product TYPE (insecticide, fertilizer, …) while
// `division` describes the LINE OF SERVICE it is bought for (General Household
// Pest, Lawn & Ornamental, Termite, Rodent, Other). Stored on Product.division /
// Product.subdivision; the UI constrains a subdivision to its division's list.
// ---------------------------------------------------------------------------
export const DIVISIONS = ["GHP", "LO", "MOSQUITO", "TERMITE", "RODENT", "OTHER"] as const;
export type Division = (typeof DIVISIONS)[number];

export const DIVISION_LABELS: Record<Division, string> = {
  GHP: "General Household Pest",
  LO: "Lawn & Ornamental",
  MOSQUITO: "Mosquito",
  TERMITE: "Termite",
  RODENT: "Rodent",
  OTHER: "Other",
};

export const SUBDIVISIONS: Record<Division, string[]> = {
  GHP: ["General Insecticide", "Bait", "Aerosol/Contact", "IGR", "Fly/Monitoring"],
  LO: ["Herbicide", "Liquid Fertilizer", "Granular Fertilizer", "Fungicide", "Ornamental Insecticide", "Adjuvant"],
  MOSQUITO: ["Adulticide", "Larvicide", "Barrier/Yard"],
  TERMITE: ["Liquid", "Foam", "Wood/Borate"],
  RODENT: ["Bait", "Trap", "Station"],
  OTHER: ["Cleaner", "Misc", "Non-Chemical"],
};

/** Human label for a division code (falls back to the raw value). */
export function divisionLabel(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  return (DIVISION_LABELS as Record<string, string>)[c] ?? (c || "—");
}

/** True when `code` is one of the canonical division codes. */
export function isDivision(code: string | null | undefined): code is Division {
  return DIVISIONS.includes((code ?? "").trim().toUpperCase() as Division);
}

/**
 * Validate/normalize a (division, subdivision) pair. Returns canonical values, or
 * nulls when unknown. A subdivision is only kept when it belongs to its division.
 */
export function normalizeClassification(
  division: string | null | undefined,
  subdivision: string | null | undefined
): { division: Division | null; subdivision: string | null } {
  const d = (division ?? "").trim().toUpperCase();
  if (!isDivision(d)) return { division: null, subdivision: null };
  const sub = (subdivision ?? "").trim();
  const valid = SUBDIVISIONS[d].find((s) => s.toLowerCase() === sub.toLowerCase()) ?? null;
  return { division: d, subdivision: valid };
}

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
 * Best-effort categorization of a product into the fixed taxonomy, using its
 * name plus (optionally) active ingredient, target pest, and unit code. Ordered
 * so the most specific signal wins. Imported data is a starting point —
 * categories can always be corrected in Manage afterwards.
 */
export function categorizeProduct(
  name: string,
  activeIngredient = "",
  targetPest = "",
  uom = ""
): string {
  const s = `${name} ${activeIngredient} ${targetPest}`.toLowerCase();
  const u = uom.trim().toUpperCase();
  const exact = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === name.toLowerCase().trim());
  if (exact) return exact;

  if (/termiticide|termidor|taurus sc|cyper tc|dominion 2l|altriset|topchoice|\btermite/.test(s))
    return "Termiticide";
  if (/rodent|bait block|bait station|snap trap|glue board|glue trap|\bmouse\b|\bmice\b|\brat\b|victor|trapper|catchmaster|eaton|contrac|fastrac|just one bite|protecta|t-rex|tomcat|stick-?em/.test(s))
    return "Rodent";
  if (/herbicid|post emergent|pre.?emergent|\bweed\b|broadleaf|sedge|2,4-d|glyphosate|prosecutor|roundup|quikpro|non.?selective|celsius|certainty|avenue|speedzone|barricade|dimension|prodiamine|dismiss|blindside|drive xlr|metsulfuron|atrazine|\bimage\b|fusilade|ronstar|msma|nutsedge|mansion|sedgehammer|octane|mojave/.test(s))
    return "Herbicide";
  if (/fungicid|heritage|artavia|t-storm|cleary|3336|propiconazole|azoxystrobin|armada|banner maxx|prostar|headway|pageant|arbor otc/.test(s))
    return "Fungicide";
  if (/fertiliz|micronutrient|chelated|\biron\b|phyte|k-flow|k-leaf|macron|coron|ele.?max|\d+-\d+-\d+|urea|potash|micros|bio.?iron|green.?flo|promicro|promate|soil amend|sulfur|spar.?tech/.test(s)) {
    if (u === "FB" || /granular|prill|\blb\b|\bbag\b|soluble|spar.?tech/.test(s)) return "Granular Fertilizer";
    return "Liquid Fertilizer";
  }
  if (/insecticide|pesticide|\bant\b|roach|cockroach|wasp|\bbee\b|flea|tick|mosquito|\bfly\b|\bigr\b|gel bait|\bdust\b|aerosol|bifen|talstar|talak|demand|temprid|suspend|tempo|alpine|advion|optigard|maxforce|gentrol|archer|acephate|cimexa|deltamethrin|imidacloprid|indoxacarb|pyreth|cb-?80|precor|onslaught|extinguish|tim-bor|d-fense|nyguard|crosscheck|safari|phantom|microcare|ultracide|transport|vendetta|shockwave|sector|arena|dipel/.test(s))
    return "Insecticide/Pesticide";
  return "Other";
}

/** Back-compat single-string categorizer (name only). */
export function normalizeCategory(raw: string | null | undefined): string {
  return categorizeProduct(raw ?? "");
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
  RT: "trap",
  PK: "pack",
  OZ: "oz",
  LB: "lb",
  G: "g",
  FL: "flat",
  EA: "each",
};

export function unitLabel(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  return UOM_LABELS[c] ?? (c ? c.toLowerCase() : "ea");
}
