// PestPac name-alias map.
//
// Purchase / transfer history from PestPac (loaded by a LATER build) refers to
// products by long material names that don't match the approved catalog's
// product names. This maps a history material name -> the approved Product.name
// so the loader can resolve a history row to the right catalog product.
//
// Resolution contract for the loader: normalizeProductName() both the history
// name and every Product.name, look the history name up in PRODUCT_ALIASES for
// an approved name, then match a Product whose normalized name equals it. The
// approved-product seed guarantees a product exists for every alias VALUE here.

/** Canonical name key: trimmed, lower-cased, whitespace-collapsed. */
export function normalizeProductName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// history material name (as printed in PestPac) -> approved Product.name
export const PRODUCT_ALIASES: Record<string, string> = {
  "contrac bait block": "Contrac Rodent Bait Blox",
  "trapper t-rex plastic snap trap": "T-Rex Snap Trap",
  "pbi gordon speedzone southern": "Speedzone Southern Herbicide",
  "lesco crosscheck 0.069% 0-0-7": "Crosscheck 0.069% Plus",
  "lesco fertilizer 21-0-6 50 lb": "Fertilizer - 21-0-6",
  "lesco k-flow liquid fert 0-0-25": "Lesco Liquid 0-0-25",
  "gentrol igr insecticide": "Gentrol IGR Concentrate",
};

/** Resolve a history material name to an approved product name, or null. */
export function resolveProductAlias(historyName: string | null | undefined): string | null {
  return PRODUCT_ALIASES[normalizeProductName(historyName)] ?? null;
}
