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
  const clusters: DuplicateCluster[] = [...bySig.entries()]
    .filter(([, ps]) => ps.length > 1 && ps.some((p) => !(p.approved && p.confirmed)))
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
const BASELINE_VERSION = "2026-10-22";

// Review markers the baseline clears so confirmed products read clean.
const STALE_MARKERS = [
  /Added from transfer history[^.]*\.\s*/gi,
  /Added from a check-in invoice[^.]*\.\s*/gi,
  /Flagged for review by catalog cleanup[^.]*\.\s*/gi,
];

export async function ensureCatalogBaseline(): Promise<{ ran: boolean; approved: number }> {
  try {
    const existing = await prisma.setting.findUnique({ where: { key: BASELINE_SETTING_KEY } }).catch(() => null);
    if (existing?.value === BASELINE_VERSION) return { ran: false, approved: 0 };

    // Only touch active products that still need a decision — leave already
    // approved+confirmed rows and rejected (inactive) rows alone.
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

    await prisma.setting.upsert({
      where: { key: BASELINE_SETTING_KEY },
      create: { key: BASELINE_SETTING_KEY, value: BASELINE_VERSION },
      update: { value: BASELINE_VERSION },
    });
    return { ran: true, approved };
  } catch (e) {
    console.error("ensureCatalogBaseline failed (non-fatal):", e);
    return { ran: false, approved: 0 };
  }
}
