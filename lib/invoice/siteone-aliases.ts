// SiteOne purchase-invoice → catalog resolution map.
//
// Used by scripts/load-purchase-invoices.ts to turn a SiteOne line item (from the
// committed JSON under prisma/data/purchase-invoices/) into a catalog Product.
//
// Why keyed by SiteOne ITEM NUMBER (not description): the SiteOne item # is the
// stable SKU. The same catalog product appears under several descriptions/sizes
// (e.g. Advion WDG ships as a 0.33 oz packet #63795N and a 16.5 oz jar #63953N;
// the Evo bait station ships as #EV8001 and the Clements-branded bulk #44244), and
// the same description can carry small transcription differences. The item # keys
// each line deterministically. Each entry documents its description(s) inline.
//
// Resolution contract (loader): for a shipped line, if item # is in SURCHARGE_ITEMS
// → never stock (pure surcharge/freight). Else look up SITEONE_ALIASES[item#] → a
// catalog Product.name; match it to an existing Product by normalizeProductName();
// if the name is in CREATED_PRODUCTS and no Product exists yet, create it
// (unconfirmed — admin confirm gate, like the check-in flow's auto-add). A line
// whose item # is NOT in either map is NOT loaded — it is reported as
// "unmatched (needs review)" so a human decides (this is where equipment, PPE,
// cleaners and other non-chemical/non-catalog items land; we never fabricate a
// chemical product for them).

/** SiteOne item numbers that are pure surcharges/freight — never create stock. */
export const SURCHARGE_ITEMS = new Set<string>([
  "FS-AS", // FUEL SURCHARGE
]);

/**
 * Genuinely-missing real chemicals/fertilizers found on these SiteOne invoices
 * that have no catalog entry. The loader creates each (approved=false,
 * confirmed=false — blocked from check-out until an admin confirms, same gate as
 * invoice auto-adds) with a canonical UoM code and LOS classification. Every one
 * is listed in the load report for human verification.
 */
export type CreatedProduct = {
  code: string; // canonical UoM code (lib/uom.ts)
  division: string;
  subdivision: string;
  category: string;
  manufacturer?: string;
  note: string;
};
export const CREATED_PRODUCTS: Record<string, CreatedProduct> = {
  "Flumioxazin 51 WDG Herbicide": {
    code: "J", division: "LO", subdivision: "Herbicide", category: "Herbicide", manufacturer: "Albaugh",
    note: "Added from SiteOne purchase invoice (item 298182, ALBAUGH FLUMIOXAZIN 51 WDG, 5 lb. jug) — confirm naming/UoM before check-out.",
  },
  "Lesco Momentum Southern Herbicide": {
    code: "J", division: "LO", subdivision: "Herbicide", category: "Herbicide", manufacturer: "LESCO",
    note: "Added from SiteOne purchase invoice (item 8732176, LESCO MOMENTUM SOUTHERN post-emergent, 2.5 gal. jug) — confirm naming/UoM before check-out.",
  },
  "Crosscheck 0.096% 21-0-10 Fertilizer + Insecticide": {
    code: "FB", division: "LO", subdivision: "Granular Fertilizer", category: "Fertilizer", manufacturer: "LESCO",
    note: "Added from SiteOne purchase invoice (item 291527, LESCO CROSSCHECK 0.096% 21-0-10, 50 lb. bag). Distinct SKU from the 0-0-7 crosscheck — POSSIBLE near-duplicate of the 0-0-7/0.069% crosscheck catalog lines; confirm before check-out.",
  },
  "Gentrol Aerosol": {
    code: "AC", division: "GHP", subdivision: "IGR", category: "Insecticide", manufacturer: "Zoecon",
    note: "Added from SiteOne purchase invoice (item 37820, GENTROL AEROSOL 16 oz.). Aerosol form — POSSIBLE near-duplicate of 'Gentrol IGR Concentrate' (the liquid concentrate); confirm before check-out.",
  },
  "Lesco Nutra-Tech Micro Mix Fertilizer": {
    code: "J", division: "LO", subdivision: "Liquid Fertilizer", category: "Fertilizer", manufacturer: "LESCO",
    note: "Added from SiteOne purchase invoice (item 511665-2.5, LESCO NUTRA-TECH MICRO MIX liquid fertilizer, 2.5 gal. jug) — confirm naming/UoM before check-out.",
  },
  "Lesco 8-10-10 Palm Fertilizer": {
    code: "FB", division: "LO", subdivision: "Granular Fertilizer", category: "Fertilizer", manufacturer: "LESCO",
    note: "Added from SiteOne purchase invoice (item 511385, LESCO 8-10-10 PALM & TROPICAL granular fertilizer, 50 lb. bag) — confirm naming/UoM before check-out.",
  },
  "Orthene 97 T&O Insecticide": {
    code: "B", division: "LO", subdivision: "Ornamental Insecticide", category: "Insecticide", manufacturer: "Amvac",
    note: "Added from SiteOne purchase invoice (item 12602, ORTHENE 97 T&O, .773 lb.). Acephate 97% — distinct from the catalog 'Acephate 90 Prill' (90 prill); confirm before check-out.",
  },
};

/**
 * SiteOne item # → catalog Product.name (an existing approved product, or a key
 * of CREATED_PRODUCTS). Comments give the SiteOne description and flag any line
 * where the shipped unit is a multi-pack (one shipped EA/BX = several catalog
 * units) or where a size/formulation match was approximate — all surfaced in the
 * load report for verification.
 */
export const SITEONE_ALIASES: Record<string, string> = {
  // --- Liquid insecticides / aerosols ---
  "D00001542": "CrossCheck Plus", // LESCO CROSSCHECK PLUS LIQUID INSECTICIDE 1 GAL.
  "D00000906": "Bandit 2F", // LESCO BANDIT 2F SYSTEMIC LIQUID INSECTICIDE 1 GAL. JUG
  "82004443": "bifen XTS", // BIFEN XTS INSECTICIDE 1 GAL.
  "80081D": "Demand CS", // SYNGENTA DEMAND CS 1 QT. BOTTLE
  "82008300": "Cyper TC", // CONTROL SOLUTIONS CYPER TC 1 GAL. JUG
  "7452-K07": "Shockwave", // MGK SHOCKWAVE FOGGING 1 GAL. JUG
  "27991B-K07": "Sector", // SECTOR MISTING 1 GAL. JUG
  "7485A-K07": "ULD BP-300", // ULD BP-300 FORMULA II 1 GAL.
  "11008370": "CB-80 Insecticide", // CB-80 DUAL SPRAY CAN AEROSOL 17 OZ.
  "59026330": "PT Ultraside", // PT ULTRACIDE PRESSURIZED FLEA 14 OZ.
  "59026327": "PT Microcare CS", // PT MICROCARE CS PRESSURIZED 14 OZ.
  "59026311": "PT Phantom", // PT PHANTOM II PRESSURIZED 14 OZ.
  "D00001534": "Wasp & Hornet Spray", // LESCO WASP & HORNET PLUS AEROSOL 14 FL OZ.
  "82003599": "Taurus SC", // CSI-PEST TAURUS SC 78 FL OZ. BOTTLE
  "D00000997": "Suspend SC", // SUSPEND SC LIQUID 1 GAL. JUG
  "85460078": "Stop The Bites!", // STOP THE BITES! PLUS 2.5 GAL. JUG
  "59014217": "PT ALPINE WSG", // ALPINE WSG INSECTICIDE 500 GM — FLAG: 500 gm pouch vs catalog bottle; size differs.
  "D00000977": "Premise Foam", // PREMISE FOAM INSECTICIDE 18 OZ.
  "59012846": "Termidor Foam", // TERMIDOR FOAM INSECTICIDE 20 OZ.

  // --- IGR ---
  "73218": "Archer IGR", // ARCHER IGR 1 PT.
  "37860A": "Gentrol IGR Concentrate", // ZOECON GENTROL IGR (10 X 1 FL OZ.) BOX — FLAG: 1 BX = 10×1floz multi-pack; counted as 1 catalog unit.
  "37820": "Gentrol Aerosol", // GENTROL AEROSOL PEST CONTROL 16 OZ. [CREATED] — aerosol form, possible dup of Gentrol IGR Concentrate.

  // --- Baits / gels ---
  "88504": "Advion cockroach gel bait", // ADVION EVOLUTION ROACH GEL 4 X 1.06 OZ — FLAG: box of 4 syringes = 1 catalog unit.
  "53204-NLA": "Advion Ant Gel", // SYNGENTA ADVION ANT GEL 4 X 30 GM TUBE — FLAG: box of 4 tubes = 1 catalog unit.
  "71339S": "Optigard Ant Gel Bait", // SYNGENTA OPTIGARD ANT GEL (4 X 30 G) BOX — FLAG: box of 4 tubes = 1 catalog unit.
  "D00000959": "Maxforce Quantum Ant Bait", // MAXFORCE QUANTUM ANT BAIT 120 GM.
  "63795N": "Advion WDG Insecticide", // ADVION WDG 0.33 OZ. PACKET
  "63953N": "Advion WDG Insecticide", // ADVION WDG 16.5 OZ. (AGENCY) — same product, larger size.

  // --- Fire-ant baits (granular) ---
  "24560-FAB": "Extinguish Plus", // WELLMARK EXTINGUISH PLUS FIRE ANT BAIT 25 LB.
  "37970": "Extinguish", // EXTINGUISH PROFESSIONAL FIRE ANT BAIT 25 LB. (methoprene-only "Pro" = catalog "Extinguish")

  // --- Granular insecticide / insecticide+fert ---
  "10580032": "Arena Granular Insecticide", // NUFARM ARENA 0.25G 30 LB. BAG
  "291500": "0-0-7 Fertilizer + Insecticide", // LESCO CROSSCHECK 0.069% 0-0-7 50 LB. (same SKU the 7/31 count booked as 0-0-7 Fertilizer + Insecticide)
  "12602": "Orthene 97 T&O Insecticide", // ORTHENE 97 .773 LB. [CREATED]
  "83014004": "Acephate 90 Prill", // ACEPHATE 90 PRILL 5 LB.

  // --- Biological ---
  "10586301": "DIPEL PRO", // DIPEL PRO DF 1 LB.

  // --- Fungicides ---
  "10441225": "T-Storm Fungicide", // LESCO T-STORM 2.5 GAL. JUG
  "040-7500": "OTC Fungicide", // ARBORJET ARBOR OTC INJECTABLE 1 OZ.
  "44882": "Headway Fungicide", // SYNGENTA HEADWAY G 30 LB. BAG

  // --- Herbicides ---
  "35720": "Sedgehammer Turf Herbicide", // SEDGEHAMMER 1.33 OZ. BOTTLE
  "10780880": "Mansion Turf Herbicide", // LESCO MANSION 8 OZ. BOTTLE
  "86703432": "Prosecutor", // LESCO PROSECUTOR PRO 2.5 GAL. JUG
  "86764776": "Roundup QuikPro Granular Herbicide", // ROUNDUP QUIKPRO 6.8 LB.
  "298182": "Flumioxazin 51 WDG Herbicide", // ALBAUGH FLUMIOXAZIN 51 WDG 5 LB. JUG [CREATED]
  "8732176": "Lesco Momentum Southern Herbicide", // LESCO MOMENTUM SOUTHERN 2.5 GAL. JUG [CREATED]
  "8731126": "Avenue South", // PBI GORDON AVENUE SOUTH 2.5 GAL. JUG

  // --- Fertilizers (granular bags) ---
  "511384": "Lesco 16-0-8 Spar Tech", // LESCO 16-0-8 SPAR-TECH 50 LB. BAG
  "511413": "Fertilizer 8-0-10 (Shrub)", // LESCO 8-0-10 SPAR-TECH 50 LB. BAG
  "511233": "Lesco 25-0-10 Granular Fert", // LESCO 25-0-10 50 LB. BAG
  "511385": "Lesco 8-10-10 Palm Fertilizer", // LESCO 8-10-10 PALM 50 LB. BAG [CREATED]
  "291527": "Crosscheck 0.096% 21-0-10 Fertilizer + Insecticide", // LESCO CROSSCHECK 0.096% 21-0-10 50 LB. [CREATED]

  // --- Fertilizers (liquid jugs / micronutrients) ---
  "511493-2.5": "Lesco Bio Iron Plus", // LESCO BIO IRON PLUS 2.5 GAL. JUG
  "098186": "Lesco T&O Chelated Liquid Fertilizer", // LESCO FLORIDA FRIENDLY AM CHELATED MICRONUTRIENT 2.5 GAL. JUG
  "098504-NLA": "Lesco Liquid 0-0-25", // LESCO K-FLOW 0-0-25 2.5 GAL. JUG
  "511649-2.5": "Lesco Liquid 0-0-25", // LESCO NUTRA-TECH 0-0-25 2.5 GAL. JUG — FLAG: Nutra-Tech premium line, price ~2x the K-Flow; matched to the same 0-0-25 liquid. Confirm if it should be its own SKU.
  "511665-2.5": "Lesco Nutra-Tech Micro Mix Fertilizer", // LESCO NUTRA-TECH MICRO MIX 2.5 GAL. JUG [CREATED]

  // --- Adjuvant ---
  "400507": "Spreader Sticker", // LESCO SPREADER STICKER 2.5 GAL.
  "400506": "Spreader Sticker", // LESCO SPREADER STICKER 1 GAL. — same product, 1 gal size.

  // --- Rodent / bait stations ---
  "CB4051": "Contrac Rodent Bait Blox", // CONTRAC ALL-WEATHER BLOX 18 LB. PAIL
  "EV8001": "Evo Bait Station", // PROTECTA EVO EXPRESS BAIT STATION W/ WEIGHT
  "44244": "Evo Bait Station", // CLEMENTS PC EVO EXPRESS HV (BLACK) 576 BULK — partial releases; each release checks in only its shipped qty.

  // --- Cleaner/sanitizer with a catalog match ---
  "IHSF019-12": "Invade Hot Spot", // INVADE HOT SPOT+ BIO FOAM SANITIZER 19 OZ.
};
