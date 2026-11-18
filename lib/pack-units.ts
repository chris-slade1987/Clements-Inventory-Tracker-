// ---------------------------------------------------------------------------
// Pack-sold products are stocked and issued as SINGLE units (COO 2026-11-18):
// "managers hand out tubes 1 at a time rather than in 4 packs … anything listed as
// a pack gets broken down into individual tubes and priced accordingly … only able
// to be checked out in the tube unit."
//
// Each product here gets Product.unitsPerCase = `per` and its single unit, so:
//   • Check-In counts PACKS and adds `per` single units each at pack price ÷ per;
//   • Check-Out issues single units only (quantity is always in the product unit);
//   • existing on-hand converts once (lib/pack-units-ensure.ts).
// Pure data (no server-only) so the catalog seed/cleanup can respect it too.
// Matched on the catalog's full name or its short name (compact, case-insensitive).
// ---------------------------------------------------------------------------

export type PackProduct = { name: string; short: string; per: number; unit: "T" | "EA"; single: string };

export const PACK_PRODUCTS: PackProduct[] = [
  { name: "Advion Ant Gel Bait 4 x 30 gm tube (1pk/4 tubes)", short: "Advion Ant Gel", per: 4, unit: "T", single: "tube" },
  { name: "Advion Evolution Cockroach Gel Bait 4x30g (4 pack)", short: "Advion cockroach gel bait", per: 4, unit: "T", single: "tube" },
  { name: "Alpine Cockroach Gel Bait Rotation 1 Box (4 x 30 gm) Syringes", short: "Alpine Roach Gel Bait", per: 4, unit: "T", single: "tube" },
  { name: "Optigard Ant Gel Bait 4 x 30 gm.", short: "Optigard Ant Gel Bait", per: 4, unit: "T", single: "tube" },
  { name: "Optigard Cockroach Gel Bait 4x30g (4 pack)", short: "Optigard Cockroach Gel Bait", per: 4, unit: "T", single: "tube" },
  { name: "Lutz Perfect Spike 8-10-10 Tree/Shrub Spike 5 pk.", short: "Lutz Perfect Spike", per: 5, unit: "EA", single: "spike" },
];

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_KEY = new Map<string, PackProduct>();
for (const p of PACK_PRODUCTS) {
  BY_KEY.set(compact(p.name), p);
  BY_KEY.set(compact(p.short), p);
}

/** The pack rule for a product name (full or short), or null. */
export function packProductFor(name: string | null | undefined): PackProduct | null {
  return BY_KEY.get(compact(name ?? "")) ?? null;
}

/** Word for the outer container on Check-In: "pack" for pack-sold items, else "case". */
export function packWord(name: string | null | undefined): "pack" | "case" {
  return packProductFor(name) ? "pack" : "case";
}
