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
//
// KEYS must already be normalized (lower-cased, whitespace-collapsed) exactly as
// normalizeProductName() would produce — the loader normalizes the history name
// before the lookup, so a key with stray double-spaces would never match.
//
// VALUES must equal a real approved Product.name (guaranteed by
// prisma/seed-products-approved.ts). PestPac truncates material names to ~30
// chars, so many keys are the truncated forms exactly as they appear in the
// transfer-history export.
export const PRODUCT_ALIASES: Record<string, string> = {
  // --- Phase 1 (Naples) ---
  "contrac bait block": "Contrac Rodent Bait Blox",
  "trapper t-rex plastic snap trap": "T-Rex Snap Trap",
  "pbi gordon speedzone southern": "Speedzone Southern Herbicide",
  "lesco crosscheck 0.069% 0-0-7": "Crosscheck 0.069% Plus",
  "lesco fertilizer 21-0-6 50 lb": "Fertilizer - 21-0-6",
  "lesco k-flow liquid fert 0-0-25": "Lesco Liquid 0-0-25",
  "gentrol igr insecticide": "Gentrol IGR Concentrate",

  // --- Phase 2: 4-branch transfer histories (Naples/Orlando/Stuart/Vero) ---
  // Long / truncated PestPac material names -> approved catalog names.
  "avenue south post emergent liq": "Avenue South",
  "bifen xts insecticide 1 gal.": "bifen XTS",
  "dipel pro df biological insect": "DIPEL PRO",
  "gentrol igr insecticide 10/ 1": "Gentrol IGR Concentrate",
  "lesco bandit 2f systemic liqui": "Bandit 2F",
  "lesco bio iron plus liquid fer": "Lesco Bio Iron Plus",
  "lesco crosscheck plus liquid i": "CrossCheck Plus",
  "lesco k-flowliquid fert 0-0-25": "Lesco Liquid 0-0-25",
  "lesco mansion post emergent dr": "Mansion Turf Herbicide",
  "lesco spreader sticker 2.5 gal": "Spreader Sticker",
  "misc chemical": "Miscellaneous Chemical",
  "misc fertilizer": "Miscellaneous Fertilizer",
  "sedgehammer soluble herbicide": "Sedgehammer Turf Herbicide",
  "syngenta heritage gran fung": "Syngenta Heritage Granular Fungicide",
  "taurus sc insecticide 78 oz.": "Taurus SC",
  "trapper t-rex plastic snap tra": "T-Rex Snap Trap",
  "uld bp-300 formula ii insectic": "ULD BP-300",
  "victor m9 pro rat trap (12/c)": "Victor M9 Pro Rat Trap",
  // Orlando
  "cb-80 dual spray can aerosol i": "CB-80 Insecticide",
  "demand cs insecticide 1 qt.": "Demand CS",
  "lesco 24-0-11 50 lb. bag": "Fertilizer 24-0-11 (Turf)",
  "lesco crosscheck pl": "Crosscheck 0.069% Plus", // truncated + UoM FB (granular) -> the 0-0-7 granular
  "lesco l&o palm 8-0-10 ranular": "Fertilizer 8-0-10 (Shrub)",
  "lesco t-storm liquid fungicide": "T-Storm Fungicide",
  "maxforce quantum ant bait 120": "Maxforce Quantum Ant Bait",
  "nufarm arena 0.25g granular": "Arena Granular Insecticide",
  "optigard ant gel bait 4 x 30 g": "Optigard Ant Gel Bait",
  "pt alpine pressurized insectic": "PT Alpine",
  "pt alpine wsg insecticide 500": "PT ALPINE WSG",
  "sector misting insecticide 1 g": "Sector",
  "sygenta headway g broad spectr": "Headway Fungicide",
  "vendetta plus roaach bait 30 g": "Vendetta Plus",
  "wellmark extinguish plus fire": "Extinguish Plus",
  // Stuart
  "advion evolution cockroach gel": "Advion cockroach gel bait",
  "alpine wsg insecticide (10 gm)": "PT ALPINE WSG", // 10gm packet, mapped to PT Alpine WSG — flagged for HR confirm
  "celsius post emergent water di": "Celsius",
  "cyper tc termiticide/insectici": "Cyper TC",
  "deltadust insecticide": "Delta dust",
  "lesco 19-19-19 soluble fertil": "19-19-19 Sprayable fertilizer",
  "lesco t-storm 2g granular": "T-Storm Fungicide", // granular form of T-Storm — flagged (pack/form differs)
  "maxforce complete insect bait": "Maxforce Complete Granular Bait",
  "protecta evo express bait stat": "Evo Bait Station",
  "pt microcare cs pressurized in": "PT Microcare CS",
  "pt phantom ii pressurized inse": "PT Phantom",
  "pt ultracide pressurized flea": "PT Ultraside",
  "safari 20 sg insecticide 3 lb.": "Safari SG",
  "termidor foam insecticide 20 o": "Termidor Foam",
  // Vero Beach (HQ)
  "advion ant gel bait": "Advion Ant Gel",
  "advion insect granule 25 lb.": "Advion Insect Granular",
  "arborjet arbor otc injectable": "OTC Fungicide", // confirm — tree-injection OTC mapped to approved OTC Fungicide
  "archer igr insecticide 1 pt.": "Archer IGR",
  "extinguish plus 4.5lb": "Extinguish Plus",
  "extinguish pro fire ant bait": "Extinguish", // "Pro" (methoprene-only) -> Extinguish, distinct from Extinguish Plus
  "invade hot spot pest control 1": "Invade Hot Spot",
  "lesco aerosol wasp and hornet": "Wasp & Hornet Spray",
  "lesco atrazine post emergent p": "Atrazine",
  "lesco fertilizer 10-0-12 50 lb": "Lesco 10-0-12",
  "lesco prosecutor pro non selec": "Prosecutor",
  "lesco t&o chelated liquid chel": "Lesco T&O Chelated Liquid Fertilizer",
  "shockwave fogging concentrate": "Shockwave",
  "topchoice granular insecticide": "Top Choice",
  "transport mikron insecticide 1": "Transport Mikron Insecticide",

  // --- Products ADDED from transfer history (see prisma/seed-products-approved.ts ADDED) ---
  "catchmaster pb glue board": "Catchmaster PB Glue Board",
  "precor 2000 premise spray 16 o": "Precor 2000 Premise Spray",
  "pt pi pressurized contact": "PT PI Pressurized Contact",
  "pageant intrinsic fungicide": "Pageant Intrinsic Fungicide",
  "roundup quikro gran herbicide": "Roundup QuikPro Granular Herbicide",
  "960 vector fruit fly trap": "Vector Fruit Fly Trap",
  "eaton stick-em rat and mouse": "Eaton Stick-Em Rat and Mouse",
  "lesco 13-3-13 spar-tech t&o gr": "Lesco 13-3-13 Spar-Tech",
  "lesco 16-0-8 spar tech": "Lesco 16-0-8 Spar Tech",
  "lesco macron soluble fertilize": "Lesco Macron Soluble Fertilizer",
  "promate 20-0-10": "Promate 20-0-10",
  "stop the bites!": "Stop The Bites!",
};

/** Resolve a history material name to an approved product name, or null. */
export function resolveProductAlias(historyName: string | null | undefined): string | null {
  return PRODUCT_ALIASES[normalizeProductName(historyName)] ?? null;
}
