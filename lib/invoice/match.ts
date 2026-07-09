// Fuzzy-match a parsed invoice line description to a catalog product.

export type MatchCandidate = {
  id: string;
  name: string;
  distributorSku: string | null;
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

// Distinctive words score more: len>=4 => 2 pts, len 3 => 1 pt, shorter => 0.
function tokenWeight(t: string): number {
  if (t.length >= 4) return 2;
  if (t.length === 3) return 1;
  return 0;
}

/**
 * Returns the best-matching product id for a description, or null if no
 * candidate is confident enough. An exact distributor-SKU hit always wins.
 */
export function matchProduct(
  description: string,
  sku: string | null,
  products: MatchCandidate[]
): string | null {
  if (sku) {
    const bySku = products.find(
      (p) => p.distributorSku && p.distributorSku.toLowerCase() === sku.toLowerCase()
    );
    if (bySku) return bySku.id;
  }

  const descTokens = new Set(tokens(description));
  let bestId: string | null = null;
  let bestScore = 0;

  for (const p of products) {
    let score = 0;
    for (const t of tokens(p.name)) {
      if (descTokens.has(t)) score += tokenWeight(t);
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = p.id;
    }
  }

  // Require at least one distinctive shared word (>= 2 points).
  return bestScore >= 2 ? bestId : null;
}
