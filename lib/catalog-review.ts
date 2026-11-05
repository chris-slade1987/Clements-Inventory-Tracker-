import "server-only";
import { prisma } from "@/lib/prisma";
import { uomLabel } from "@/lib/uom";
import { divisionLabel } from "@/lib/constants";

// Catalog Review (consolidation) data. Three buckets a human works through:
//   - pending:     confirmed=false products (the existing new-product confirm queue)
//   - offCatalog:  approved=false, confirmed, active — real items that need an
//                  Approve / Merge / Discard decision (your "should this be on the
//                  approved catalog?" pile)
//   - clusters:    groups of active products whose names look like duplicates
//                  (same base name ignoring brand prefix, digits/sizes, casing),
//                  so near-duplicates like the Cross-Check family land side by side
//                  for a human to merge or keep-both.

export type ReviewProduct = {
  id: string;
  name: string;
  approved: boolean;
  confirmed: boolean;
  unitOfMeasure: string;
  unitLabel: string;
  division: string | null;
  divisionLabel: string;
  distributorSku: string | null;
  manufacturer: string | null;
  onHand: number;
  allCaps: boolean;
  notes: string | null;
  /** True when the product is backed by invoice data (has invoice lines OR a
   *  SiteOne item number from the owner master) — the "keep it" signal. */
  inInvoices: boolean;
};

export type DuplicateCluster = { key: string; products: ReviewProduct[] };

const BRAND_PREFIX = /^(lesco|bwi|siteone|site one|pbi gordon|pbi|gordon|qualipro|quali-pro)\s+/i;

/** Duplicate-detection signature: drop a leading brand word, strip digits/sizes and
 *  punctuation, collapse to letters, take the first 8 — so "CrossCheck Plus",
 *  "Crosscheck 0.069% Plus", and "LESCO CROSSCHECK PLUS LIQUID 1 GAL" all share a
 *  signature and cluster together for review (the human decides same vs. different). */
export function dupSignature(name: string): string {
  let s = (name ?? "").trim();
  s = s.replace(BRAND_PREFIX, "");
  s = s.toLowerCase().replace(/[0-9]/g, "").replace(/[^a-z]/g, "");
  return s.slice(0, 8);
}

// Size / packaging / unit words dropped when tokenizing a name for duplicate
// detection, so "Archer IGR" and "Archer IGR Insecticide 1 qt" compare on their
// meaningful words only.
const SIZE_UNIT_TOKENS = new Set([
  "gal", "gallon", "gallons", "qt", "qts", "quart", "quarts", "oz", "ozs", "ounce", "ounces",
  "lb", "lbs", "pound", "pounds", "ml", "l", "g", "kg", "ct", "cts", "pk", "pack", "case", "cases",
  "bottle", "bottles", "jug", "jugs", "pail", "pails", "bag", "bags", "box", "boxes", "each", "ea",
  "liquid", "concentrate", "conc",
]);

/** Meaningful-word tokens of a product name (brand prefix, sizes/units, digits and
 *  punctuation removed) for near-duplicate detection. */
export function nameTokens(name: string): string[] {
  const s = (name ?? "").toLowerCase().replace(BRAND_PREFIX, "").replace(/[^a-z0-9\s]/g, " ");
  return s.split(/\s+/).filter((t) => t && !/\d/.test(t) && !SIZE_UNIT_TOKENS.has(t));
}

function isTokenSubset(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bs = new Set(b);
  return a.every((t) => bs.has(t));
}

/** True when two products in a cluster look like the SAME product at different
 *  verbosity — one's meaningful-token set is contained in the other's. Catches
 *  "Archer IGR" ⊂ "Archer IGR Insecticide 1 qt" and "Avenue South Emergent
 *  Herbicide" ⊂ "Avenue South Post Emergent Liquid Herbicide 2.5 gal", so these
 *  surface in Catalog Review → Duplicates even after both rows were approved. */
export function hasNearDuplicatePair(ps: { name: string }[]): boolean {
  const toks = ps.map((p) => nameTokens(p.name));
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      if (isTokenSubset(toks[i], toks[j]) || isTokenSubset(toks[j], toks[i])) return true;
    }
  }
  return false;
}

const isAllCaps = (name: string) => /[A-Z]/.test(name) && name === name.toUpperCase();

function toReview(p: {
  id: string; name: string; approved: boolean; confirmed: boolean; unitOfMeasure: string;
  division: string | null; distributorSku: string | null; vendorItemNumbers: string | null; manufacturer: string | null; notes: string | null;
}, onHand: Map<string, number>, invoiced: Set<string>): ReviewProduct {
  return {
    id: p.id, name: p.name, approved: p.approved, confirmed: p.confirmed,
    unitOfMeasure: p.unitOfMeasure, unitLabel: uomLabel(p.unitOfMeasure),
    division: p.division, divisionLabel: divisionLabel(p.division),
    distributorSku: p.distributorSku, manufacturer: p.manufacturer,
    onHand: onHand.get(p.id) ?? 0, allCaps: isAllCaps(p.name), notes: p.notes,
    inInvoices: invoiced.has(p.id) || !!p.distributorSku || !!p.vendorItemNumbers,
  };
}

export async function catalogReview(): Promise<{
  all: ReviewProduct[];
  pending: ReviewProduct[];
  offCatalog: ReviewProduct[];
  clusters: DuplicateCluster[];
  confirmedProducts: { id: string; name: string }[];
}> {
  const [active, movements, invLines] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, approved: true, confirmed: true, unitOfMeasure: true, division: true, distributorSku: true, vendorItemNumbers: true, manufacturer: true, notes: true },
    }),
    prisma.stockMovement.groupBy({ by: ["productId"], _sum: { quantity: true } }),
    prisma.invoiceLine.groupBy({ by: ["productId"], _count: { _all: true } }),
  ]);
  const onHand = new Map<string, number>();
  for (const m of movements) onHand.set(m.productId, m._sum.quantity ?? 0);
  const invoiced = new Set<string>();
  for (const l of invLines) if (l.productId) invoiced.add(l.productId);

  const rows = active.map((p) => toReview(p, onHand, invoiced));

  // The flat approve/reject list: everything still needing a decision first
  // (not yet approved+confirmed), invoice-backed items above non-invoice ones,
  // then alphabetical.
  const all = [...rows].sort((a, b) => {
    const ad = a.approved && a.confirmed ? 1 : 0, bd = b.approved && b.confirmed ? 1 : 0;
    if (ad !== bd) return ad - bd;
    if (a.inInvoices !== b.inInvoices) return a.inInvoices ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const pending = rows.filter((r) => !r.confirmed);
  const offCatalog = rows.filter((r) => r.confirmed && !r.approved);

  // Duplicate clusters among active products. A cluster only surfaces when it still
  // has an UNRESOLVED member (something not yet approved+confirmed) — once the whole
  // look-alike group is on the approved catalog (the source of truth), it's no longer
  // "work to do" and drops off. A newly brought-in off-catalog item that collides with
  // an existing approved name re-surfaces the cluster, with the approved twin alongside
  // it so a human can merge or keep-both.
  const bySig = new Map<string, ReviewProduct[]>();
  for (const r of rows) {
    const sig = dupSignature(r.name);
    if (sig.length < 4) continue; // too short to be a reliable signature
    (bySig.get(sig) ?? bySig.set(sig, []).get(sig)!).push(r);
  }
  // Surface a cluster when it still has an UNRESOLVED member (the original rule) OR
  // when it contains a near-duplicate pair even if every row is already approved —
  // so nickname-vs-full-description look-alikes (Archer IGR, Avenue South, etc.) can
  // be found and merged after the fact, instead of silently living as two catalog
  // rows (which also splits on-hand and can block check-out of the "wrong" twin).
  const clusters: DuplicateCluster[] = [...bySig.entries()]
    .filter(([, ps]) => ps.length > 1 && (ps.some((p) => !(p.approved && p.confirmed)) || hasNearDuplicatePair(ps)))
    .map(([key, ps]) => ({ key, products: ps.sort((a, b) => (b.approved ? 1 : 0) - (a.approved ? 1 : 0) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.products.length - a.products.length || a.key.localeCompare(b.key));

  const confirmedProducts = rows.filter((r) => r.confirmed && r.approved).map((r) => ({ id: r.id, name: r.name }));
  return { all, pending, offCatalog, clusters, confirmedProducts };
}

// One-time catalog baseline. The managers curated the active product list into the
// current source of truth, so every ACTIVE product is accepted onto the approved
// catalog in a single pass (approved + confirmed) and the stale auto-added review
// markers are stripped from notes. This empties the Approve/Reject, Off-catalog and
// New-products queues without touching rejected (inactive) products and WITHOUT
// hard-deleting anything (flags + note cleanup only — the core data rule holds).
//
// Gated by a Setting row so it runs exactly once per version on the live DB (prod
// only takes runtime writes, so this fires on the first admin load of Catalog
// Review after deploy, never again). Bump BASELINE_VERSION to re-baseline later.
const BASELINE_SETTING_KEY = "catalog-baseline-approved";
// 2026-11-05: re-baseline. The catalog is finalized (on-hand loaded + Naples
// disbursements tested), so the COO asked to clear the review backlog that had
// re-accumulated from invoice/dispersal back-loads: Approve/Reject, Off-catalog,
// Duplicates, and New products all go to zero by flags only (approved+confirmed) —
// NO stock-movement changes, so on-hand is untouched. Also archives the standing
// Rejected backlog out of the Rejected tab (keeps the discard marker so the deploy
// reconcile still holds them inactive — nothing is resurrected or hard-deleted).
const BASELINE_VERSION = "2026-11-05";

// Review markers the baseline clears so confirmed products read clean.
const STALE_MARKERS = [
  /Added from transfer history[^.]*\.\s*/gi,
  /Added from a check-in invoice[^.]*\.\s*/gi,
  /Flagged for review by catalog cleanup[^.]*\.\s*/gi,
];

// Appended to a rejected (discarded) product's notes so the Rejected tab stops
// listing the already-handled backlog, WITHOUT removing DISCARD_MARK (the deploy
// reconcile keys off DISCARD_MARK to keep the product inactive/off-catalog).
export const REJECTED_ARCHIVED_MARK = "Rejected backlog acknowledged";

export async function ensureCatalogBaseline(): Promise<{ ran: boolean; approved: number; archivedRejected: number }> {
  try {
    const existing = await prisma.setting.findUnique({ where: { key: BASELINE_SETTING_KEY } }).catch(() => null);
    if (existing?.value === BASELINE_VERSION) return { ran: false, approved: 0, archivedRejected: 0 };

    // Only touch active products that still need a decision — leave already
    // approved+confirmed rows alone. Flags + note cleanup only; never a movement,
    // so on-hand (= SUM of movements) cannot change.
    const pending = await prisma.product.findMany({
      where: { active: true, OR: [{ approved: false }, { confirmed: false }] },
      select: { id: true, notes: true },
    });

    let approved = 0;
    for (const p of pending) {
      let notes = p.notes ?? null;
      if (notes) {
        for (const re of STALE_MARKERS) notes = notes.replace(re, "");
        notes = notes.trim() || null;
      }
      try {
        await prisma.product.update({
          where: { id: p.id },
          data: { approved: true, confirmed: true, notes },
        });
        approved++;
      } catch (e) {
        console.error("ensureCatalogBaseline: failed to approve", p.id, e);
      }
    }

    // Archive the standing Rejected backlog: append the archived marker so the
    // Rejected tab (which filters it out) empties, while KEEPING DISCARD_MARK so the
    // product stays inactive. Inactive rows carry no live on-hand, so this is safe.
    let archivedRejected = 0;
    const rejected = await prisma.product.findMany({
      where: {
        active: false,
        notes: { contains: "Discarded from confirm queue" },
        NOT: { notes: { contains: REJECTED_ARCHIVED_MARK } },
      },
      select: { id: true, notes: true },
    });
    for (const p of rejected) {
      try {
        await prisma.product.update({
          where: { id: p.id },
          data: { notes: [p.notes, `${REJECTED_ARCHIVED_MARK}.`].filter(Boolean).join(" ") },
        });
        archivedRejected++;
      } catch (e) {
        console.error("ensureCatalogBaseline: failed to archive rejected", p.id, e);
      }
    }

    await prisma.setting.upsert({
      where: { key: BASELINE_SETTING_KEY },
      create: { key: BASELINE_SETTING_KEY, value: BASELINE_VERSION },
      update: { value: BASELINE_VERSION },
    });
    return { ran: true, approved, archivedRejected };
  } catch (e) {
    console.error("ensureCatalogBaseline failed (non-fatal):", e);
    return { ran: false, approved: 0, archivedRejected: 0 };
  }
}
