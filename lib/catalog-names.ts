// Full product descriptions for the approved catalog (COO directive 2026-11-10:
// "There shouldn't be nicknames listed, only full product descriptions").
//
// The approved catalog was built from the PestPac product list, whose names are
// short nicknames ("20-20-20 Sprayable Fertilizer"). The full SiteOne description
// for each comes from the owner's product catalog
// (prisma/data/inventory-reset/01_product_catalog.csv), lightly cleaned of typos.
//
// The short PestPac name stays the STABLE KEY everywhere data is matched (alias
// maps, the 10/30 baseline, receipts, the approved-catalog seed): every lookup runs
// through canonicalProductName(), so a PestPac report that says "CB-80 Insecticide"
// still lands on "CB-80 Dual Spray Can Aerosol Insecticide 17 oz.".
//
// No "server-only" and no imports: used by the seed, the alias maps and the runtime
// cleanup (lib/catalog-cleanup.ts).

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** PestPac short name -> full product description (applied). */
export const CATALOG_FULL_NAMES: Record<string, string> = {
  "Acephate 90 Prill": "Acephate 90 Prill Insecticide 5 lb.",
  "Advion Ant Gel": "Advion Ant Gel Bait 4 x 30 gm tube (1pk/4 tubes)",
  "Advion cockroach gel bait": "Advion Evolution Cockroach Gel Bait 4x30g (4 pack)",
  "Advion Insect Granular": "Advion Insect Granule 25 lb.",
  "Advion WDG Insecticide": "Advion WDG Insecticide 5 Packets x 0.33oz",
  "Alpine Roach Gel Bait": "Alpine Cockroach Gel Bait Rotation 1 Box (4 x 30 gm) Syringes",
  "OTC Fungicide": "Arborjet Arbor OTC Injectable Fungicide 5 oz.",
  "Archer IGR": "Archer IGR Insecticide 1 pt.",
  "Avenue South": "Avenue South Post Emergent Liquid Herbicide 2.5 gal.",
  "bifen XTS": "Bifen XTS Insecticide 1 gal.",
  "CB-80 Insecticide": "CB-80 Dual Spray Can Aerosol Insecticide 17 oz.",
  "Celsius": "Celsius Post Emergent Water Dispersible Granule Herbicide 10 oz.",
  "Certainty": "Certainty Turf Post Emergent Dry Herbicide",
  "Contrac Rodent Bait Blox": "Contrac Bait Block CB4052 18 lb. Pail",
  "Cyper TC": "Cyper TC Termiticide/Insecticide 1 gal.",
  "Delta dust": "DeltaDust Insecticide",
  "Demand CS": "Demand CS Insecticide 1 qt.",
  "DIPEL PRO": "DiPel PRO DF Biological Insecticide 1 lb.",
  "Extinguish": "Extinguish Professional Fire Ant Bait (25 lb. bag)",
  "Gentrol IGR Concentrate": "Gentrol IGR Insecticide 10 / 1 oz. Bottles",
  "Invade Hot Spot": "Invade Hot Spot Pest Control 16 oz.",
  "19-19-19 Sprayable fertilizer": "LESCO 19-19-19 Soluble Fertilizer 25 lb. Bag",
  "20-0-0 Liquid Fertilizer": "LESCO 20-0-0 Liquid Fertilizer 2.5 gal. Jug",
  "Fertilizer 24-0-11 (Turf)": "LESCO 24-0-11 50 lb. Bag",
  "33-0-17 Sprayable Fertilizer": "LESCO 33-0-17 AM Turf Soluble Fertilizer 50 lb. Bag",
  "Wasp & Hornet Spray": "LESCO Aerosol Wasp and Hornet Spray",
  "Bandit 2F": "LESCO Bandit 2F Systemic Liquid Insecticide 1 gal. Jug",
  "Lesco Bio Iron Plus": "LESCO Bio Iron Plus Liquid Fertilizer 2.5 gal.",
  "0-0-7 Fertilizer + Insecticide": "LESCO Crosscheck 0.069% 0-0-7 AM Insecticide Plus Fertilizer 50 lb.",
  "CrossCheck Plus": "LESCO Crosscheck Plus Liquid Insecticide 1 gal. Tip & Pour Container",
  "Lesco 10-0-12": "LESCO Fertilizer 10-0-12 50 lb.",
  "Lesco Fertilizer 13-0-0": "LESCO Fertilizer 13-0-0 2.5 gal.",
  "Fertilizer - 21-0-6": "LESCO Fertilizer 21-0-6 50 lb.",
  "Fertilizer 8-0-10 (Shrub)": "LESCO L&O Palm 8-0-10 Granular Fertilizer 50 lb. Bag",
  "Lesco Liquid 0-0-25": "LESCO K-Flow Liquid Fertilizer 0-0-25 2.5 gal.", // Julie 2026-11-13 (merged with the other listing)
  "20-20-20 Sprayable Fertilizer": "LESCO 20-20-20 AM Ornamental and Turfgrass Soluble Fertilizer 25 lb. Pail",
  "Mansion Turf Herbicide": "LESCO Mansion Post Emergent Dry Granule Herbicide 8 oz. Bottle",
  "Blackout Fertilizer 0-0-18 (turf)": "LESCO Organic/Organic-Base Fertilizer 0-0-18 40 lb.",
  "Prosecutor": "LESCO Prosecutor Pro Non-Selective Liquid Herbicide 2.5 gal.",
  "Spreader Sticker": "LESCO Spreader Sticker 2.5 gal.",
  "Lesco T&O Chelated Liquid Fertilizer": "LESCO T&O Chelated Liquid Micronutrient Fertilizer 2.5 gal. Jug",
  "T-Storm Fungicide": "LESCO T-Storm Flowable Systemic Fungicide 2.5 gal. Jug", // Julie 2026-11-13 (merged with the other listing)
  "Maxforce Complete Granular Bait": "Maxforce Complete Insect Bait 4 lb.",
  "Maxforce Quantum Ant Bait": "Maxforce Quantum Ant Bait 120 gm.",
  "Arena Granular Insecticide": "Nufarm Arena 0.25G Granular Insecticide 30 lb. Bag",
  "Optigard Ant Gel Bait": "Optigard Ant Gel Bait 4 x 30 gm.",
  "Optigard Cockroach Gel Bait": "Optigard Cockroach Gel Bait 4x30g (4 pack)",
  "Speedzone Southern Herbicide": "PBI Gordon SpeedZone Southern EW Post Emergent Liquid Herbicide",
  "Premise Foam": "Premise Foam Insecticide 18 oz.",
  "Evo Bait Station": "Protecta Evo Express Bait Station w/ Weight",
  "PT Alpine": "PT Alpine Pressurized Insecticide 14 oz.",
  "PT ALPINE WSG": "PT Alpine WSG Insecticide 500 gm",
  "PT Microcare CS": "PT Microcare CS Pressurized Insecticide 14 oz.",
  "PT Phantom": "PT Phantom II Pressurized Insecticide 14 oz.",
  "PT Ultraside": "PT Ultracide Pressurized Flea Insecticide 14 oz.",
  "PT wasp Freeze": "PT Wasp Freeze II Aerosol Insecticide 17.5 oz.",
  "Safari SG": "Safari 20 SG Insecticide 3 lb.",
  "Sector": "Sector Misting Insecticide 1 gal.",
  "Sedgehammer Turf Herbicide": "Sedgehammer Soluble Herbicide 1.33 oz. Bottle",
  "Shockwave": "Shockwave Fogging Concentrate Insecticide 1 gal.",
  "Suspend SC": "Suspend SC Insecticide 1 gal. Jug",
  "Headway Fungicide": "Syngenta Headway G Broad Spectrum Granular Fungicide 30 lb. Bag",
  "Taurus SC": "Taurus SC Insecticide 78 oz.",
  "Termidor Foam": "Termidor Foam Insecticide 20 oz.",
  "Termidor SC": "Termidor SC Termiticide/Insecticide",
  "Timbor": "Tim-bor Insecticide/Fungicide",
  "Top Choice": "TopChoice Granular Insecticide",
  "Transport Mikron Insecticide": "Transport Mikron Insecticide 1 qt.",
  "T-Rex Snap Trap": "Trapper T-Rex Plastic Snap Trap (12/case)",
  "ULD BP-300": "ULD BP-300 Formula II Insecticide 1 gal.",
  "Vendetta Plus": "Vendetta Plus Roach Bait 30 gm. x 4",
  "Extinguish Plus": "Wellmark Extinguish Plus Fire Ant Bait 25 lb.",
  // Confirmed by Julie (Chief of Staff) 2026-11-11.
  "Atrazine": "LESCO Atrazine Post Emergent Plus Fertilizer 50 lb.",
  "Lutz Perfect Spike": "Lutz Perfect Spike 8-10-10 Tree/Shrub Spike 5 pk.",
  "Artavia 2SC Fungicide": "Atticus Artavia 2 SC (Azoxy) Liquid Fungicide 1 gal. Jug",
  "Lesco 25-0-10 Granular Fert": "LESCO 25-0-10 Turfgrass Granular Fertilizer 50 lb. Bag",
  "Suspend PolyZone Insecticide": "Suspend PolyZone Insecticide 16 oz.",
  "Syngenta Heritage Granular Fungicide": "Syngenta Heritage G Granular Fungicide 30 lb. Bag",
  "Victor M9 Pro Rat Trap": "Victor M9 Professional Rat Trap (12 count/case)",
  "Catchmaster PB Glue Board": "Catchmaster Multi-Catch PB Mouse/Insect Glue Board",
  "Precor 2000 Premise Spray": "Precor 2000 Plus Premise Spray 16 oz.",
  "PT PI Pressurized Contact": "PT P.I. Pressurized Contact Insecticide 14 oz.",
  "Pageant Intrinsic Fungicide": "Pageant Intrinsic Brand Fungicide 1 lb.",
  "Roundup QuikPro Granular Herbicide": "Roundup QuikPro Non-Selective WDG Herbicide 6.8 lb.",
  "Vector Fruit Fly Trap": "Vector 960 Fruit Fly Trap 12 Count Box",
  "Eaton Stick-Em Rat and Mouse": "JT Eaton Stick-Em Rat and Mouse Glue Trap",
  "Lesco 13-3-13 Spar-Tech": "LESCO 13-3-13 Spar-Tech T&O Granular Fertilizer",
  "Lesco 16-0-8 Spar Tech": "LESCO 16-0-8 Spar-Tech Turfgrass Granular Fertilizer 50 lb. Bag",
  "Promate 20-0-10": "Pro-Mate 20-0-10 Fertilizer",
  "Stop The Bites!": "Stop the Bites! Mosquito and Tick Control 2.5 gal.",
};

/** SiteOne item numbers per catalog product (owner catalog), keyed by PestPac short
 *  name — a second, name-independent way to recognize a duplicate product row. */
export const CATALOG_ITEM_NUMBERS: Record<string, string[]> = {
  "Acephate 90 Prill": ["83014004"],
  "Advion Ant Gel": ["53204"],
  "Advion cockroach gel bait": ["88501", "88504"],
  "Advion WDG Insecticide": ["63795N"],
  "Archer IGR": ["73218"],
  "Avenue South": ["8731126"],
  "bifen XTS": ["82004443"],
  "CB-80 Insecticide": ["11008370"],
  "Celsius": ["D00000911"],
  "Contrac Rodent Bait Blox": ["CB4051"],
  "Cyper TC": ["82008300"],
  "Demand CS": ["80081D"],
  "DIPEL PRO": ["10586301"],
  "Extinguish": ["37970"],
  "Gentrol IGR Concentrate": ["37860A"],
  "Invade Hot Spot": ["IHSF019-12"],
  "19-19-19 Sprayable fertilizer": ["511621"],
  "Wasp & Hornet Spray": ["D00001534"],
  "Bandit 2F": ["D00000906"],
  "Lesco Bio Iron Plus": ["511493-2.5"],
  "0-0-7 Fertilizer + Insecticide": ["092003", "291500"],
  "CrossCheck Plus": ["D00001542"],
  "Fertilizer 8-0-10 (Shrub)": ["511413"],
  "Lesco Liquid 0-0-25": ["098504", "511649-2.5"],
  "Mansion Turf Herbicide": ["10780880"],
  "Prosecutor": ["86703432"],
  "Spreader Sticker": ["400507"],
  "Lesco T&O Chelated Liquid Fertilizer": ["098186"],
  "T-Storm Fungicide": ["10441225"],
  "Maxforce Complete Granular Bait": ["D00000948"],
  "Maxforce Quantum Ant Bait": ["D00000959"],
  "Arena Granular Insecticide": ["10580032"],
  "Optigard Ant Gel Bait": ["71339S"],
  "PT Alpine": ["59026328"],
  "PT ALPINE WSG": ["59014217"],
  "PT Microcare CS": ["59026327"],
  "PT Phantom": ["59026311"],
  "PT Ultraside": ["59026330"],
  "PT wasp Freeze": ["59026305"],
  "Premise Foam": ["D00000977"],
  "Evo Bait Station": ["44244", "EV8001"],
  "Sector": ["27991B-K07"],
  "Sedgehammer Turf Herbicide": ["35720"],
  "Shockwave": ["7452-K07"],
  "Suspend SC": ["D00000997"],
  "Headway Fungicide": ["44882"],
  "Taurus SC": ["82003599"],
  "Termidor Foam": ["59012846"],
  "Top Choice": ["D00001012"],
  "ULD BP-300": ["7485A-K07"],
  "Vendetta Plus": ["2976-H40"],
  "Extinguish Plus": ["24560-FAB"],
};

/** Full names drafted but not yet applied — none open (Julie confirmed all 22 on 2026-11-11). */
export const PENDING_FULL_NAMES: { short: string; draft: string; note: string; mergeInto: string | null }[] = [];

/** Catalog rows that were the SAME product as another catalog row (Julie,
 *  2026-11-11): source short name -> target short name. The source is merged into
 *  the target (stock + history move over) and its name resolves to the target. */
export const CATALOG_MERGES: Record<string, string> = {
  "Crosscheck 0.069% Plus": "0-0-7 Fertilizer + Insecticide",
  "Lesco Macron Soluble Fertilizer": "20-20-20 Sprayable Fertilizer",
  // Julie 2026-11-13: same products listed twice — merge into the second name.
  // (Both listings of 0-0-25 and T-Storm are matched through the target's current
  // and previous names; the survivor carries Julie's chosen name.)
  "LESCO Bandit 2F Insecticide/Miticide 1 gal.": "Bandit 2F",
  "LESCO Mansion Turf Herbicide": "Mansion Turf Herbicide",
};

/** Full names applied earlier and since corrected — still recognized so the
 *  renamed row is found (short name -> earlier full names). */
export const PREVIOUS_FULL_NAMES: Record<string, string[]> = {
  "20-20-20 Sprayable Fertilizer": ["LESCO MacroN Soluble Fertilizer 20-20-20 25 lb. Bag"],
  "Lesco Liquid 0-0-25": ["LESCO Liquid Fertilizer 0-0-25 2.5 gal."],
  "T-Storm Fungicide": ["LESCO T-Storm Liquid Fungicide 2.5 gal. Jug"],
};

/** Unit-of-measure corrections (Julie, 2026-11-11), by short name. */
export const CATALOG_UNIT_OVERRIDES: Record<string, string> = {
  "Atrazine": "FB", // 50 lb. bag, not a jug
  "Suspend PolyZone Insecticide": "B", // bottle
  "20-20-20 Sprayable Fertilizer": "BU", // 25 lb. pail
};

/** PestPac catch-all categories the company no longer uses (Julie, 2026-11-11):
 *  skipped on every report/import, never entered anywhere, removed from the catalog. */
export const DISCONTINUED_PRODUCTS = ["Miscellaneous Chemical", "Miscellaneous Fertilizer"];

export function isDiscontinuedProduct(name: string | null | undefined): boolean {
  const n = norm(name);
  return DISCONTINUED_PRODUCTS.some((d) => norm(d) === n);
}

const BY_SHORT = new Map<string, string>(Object.entries(CATALOG_FULL_NAMES).map(([s, f]) => [norm(s), f]));
for (const [src, tgt] of Object.entries(CATALOG_MERGES)) BY_SHORT.set(norm(src), CATALOG_FULL_NAMES[tgt] ?? tgt);
for (const [short, olds] of Object.entries(PREVIOUS_FULL_NAMES)) for (const o of olds) BY_SHORT.set(norm(o), CATALOG_FULL_NAMES[short] ?? short);

/** The catalog's display name for a product name: the full description when the
 *  name is a PestPac short name we have one for, otherwise the name unchanged. */
export function canonicalProductName(name: string): string {
  return BY_SHORT.get(norm(name)) ?? name;
}

/** Normalized short name -> full name, for alias maps that need both keys. */
export function shortNameAliases(): Record<string, string> {
  return Object.fromEntries(BY_SHORT);
}
