import type { PrismaClient } from "@prisma/client";
import { categorizeProduct, normalizeClassification } from "../lib/constants";
import { isUomCode } from "../lib/uom";
import { normalizeProductName } from "../lib/product-aliases";

/**
 * Reconcile the CEO's approved product catalog into the database.
 *
 * - Upserts the 75 approved products (from the PestPac product list) by a stable
 *   key: the NORMALIZED product name (see normalizeProductName). Each gets its
 *   approved unit-of-measure CODE (from lib/uom.ts) and approved = true.
 * - Adds products that appear in transfer history but weren't on the sheet
 *   (flagged via `notes` so HR/admin can confirm naming).
 * - Demotes every other product to approved = false — still usable, just flagged
 *   as off-catalog — so the invariant "approved === on the CEO's list" holds.
 *
 * Idempotent: safe to run on every deploy. Never hard-deletes and never touches
 * stock movements.
 *
 * The stable upsert key (normalized name) is what the later purchase-history
 * loader must resolve to (via lib/product-aliases.ts) — do not change it without
 * updating that build.
 */

type ApprovedRow = {
  name: string;
  code: string; // canonical UoM code (lib/uom.ts)
  material: string; // PestPac Material Code (kept for the history loader)
  target: string | null;
  appMethod: string | null;
  // Line-of-service classification, stamped from CLASSIFICATION (by exact name).
  division?: string | null;
  subdivision?: string | null;
  // Case -> unit pack size (owner rule; see packSizeFor()).
  unitsPerCase?: number | null;
  // Enrichment (Part D) — factual label data for auto-added products. Left
  // undefined when not confidently known (never guessed).
  manufacturer?: string | null;
  activeIngredient?: string | null;
  enrichNote?: string | null;
};

// Authoritative line-of-service classification, keyed by the row's EXACT product
// name (applied verbatim — do NOT re-derive). The owner has decided every
// judgment call, so this map is final: no "needs confirmation" note is appended.
type Classification = { division: string; subdivision: string };
const CLASSIFICATION: Record<string, Classification> = {
  "Lutz Perfect Spike": { division: "LO", subdivision: "Granular Fertilizer" },
  "Acephate 90 Prill": { division: "LO", subdivision: "Ornamental Insecticide" },
  "Advion Ant Gel": { division: "GHP", subdivision: "Bait" },
  "Advion cockroach gel bait": { division: "GHP", subdivision: "Bait" },
  "Advion Insect Granular": { division: "GHP", subdivision: "General Insecticide" },
  "Advion WDG Insecticide": { division: "GHP", subdivision: "General Insecticide" },
  "Alpine Roach Gel Bait": { division: "GHP", subdivision: "Bait" },
  "OTC Fungicide": { division: "LO", subdivision: "Fungicide" },
  "Archer IGR": { division: "GHP", subdivision: "IGR" },
  "Avenue South": { division: "LO", subdivision: "Herbicide" },
  "bifen XTS": { division: "LO", subdivision: "Ornamental Insecticide" },
  "CB-80 Insecticide": { division: "GHP", subdivision: "Aerosol/Contact" },
  "Celsius": { division: "LO", subdivision: "Herbicide" },
  "Certainty": { division: "LO", subdivision: "Herbicide" },
  "Contrac Rodent Bait Blox": { division: "RODENT", subdivision: "Bait" },
  "Cyper TC": { division: "TERMITE", subdivision: "Liquid" },
  "Delta dust": { division: "GHP", subdivision: "General Insecticide" },
  "Demand CS": { division: "GHP", subdivision: "General Insecticide" },
  "DIPEL PRO": { division: "LO", subdivision: "Ornamental Insecticide" },
  "Extinguish": { division: "GHP", subdivision: "Bait" },
  "Gentrol IGR Concentrate": { division: "GHP", subdivision: "IGR" },
  "Invade Hot Spot": { division: "OTHER", subdivision: "Cleaner" },
  "19-19-19 Sprayable fertilizer": { division: "LO", subdivision: "Liquid Fertilizer" },
  "20-0-0 Liquid Fertilizer": { division: "LO", subdivision: "Liquid Fertilizer" },
  "Fertilizer 24-0-11 (Turf)": { division: "LO", subdivision: "Granular Fertilizer" },
  "33-0-17 Sprayable Fertilizer": { division: "LO", subdivision: "Liquid Fertilizer" },
  "Wasp & Hornet Spray": { division: "GHP", subdivision: "Aerosol/Contact" },
  "Atrazine": { division: "LO", subdivision: "Herbicide" },
  "Bandit 2F": { division: "LO", subdivision: "Ornamental Insecticide" },
  "Lesco Bio Iron Plus": { division: "LO", subdivision: "Liquid Fertilizer" },
  "0-0-7 Fertilizer + Insecticide": { division: "LO", subdivision: "Granular Fertilizer" },
  "Crosscheck 0.069% Plus": { division: "LO", subdivision: "Granular Fertilizer" },
  "CrossCheck Plus": { division: "GHP", subdivision: "General Insecticide" },
  "Lesco 10-0-12": { division: "LO", subdivision: "Granular Fertilizer" },
  "Lesco Fertilizer 13-0-0": { division: "LO", subdivision: "Liquid Fertilizer" },
  "Fertilizer - 21-0-6": { division: "LO", subdivision: "Granular Fertilizer" },
  "Fertilizer 8-0-10 (Shrub)": { division: "LO", subdivision: "Granular Fertilizer" },
  "Lesco Liquid 0-0-25": { division: "LO", subdivision: "Liquid Fertilizer" },
  "20-20-20 Sprayable Fertilizer": { division: "LO", subdivision: "Liquid Fertilizer" },
  "Mansion Turf Herbicide": { division: "LO", subdivision: "Herbicide" },
  "Blackout Fertilizer 0-0-18 (turf)": { division: "LO", subdivision: "Granular Fertilizer" },
  "Prosecutor": { division: "LO", subdivision: "Herbicide" },
  "Spreader Sticker": { division: "LO", subdivision: "Adjuvant" },
  "Lesco T&O Chelated Liquid Fertilizer": { division: "LO", subdivision: "Liquid Fertilizer" },
  "T-Storm Fungicide": { division: "LO", subdivision: "Fungicide" },
  "Maxforce Complete Granular Bait": { division: "GHP", subdivision: "Bait" },
  "Maxforce Quantum Ant Bait": { division: "GHP", subdivision: "Bait" },
  "Arena Granular Insecticide": { division: "LO", subdivision: "Ornamental Insecticide" },
  "Optigard Ant Gel Bait": { division: "GHP", subdivision: "Bait" },
  "Optigard Cockroach Gel Bait": { division: "GHP", subdivision: "Bait" },
  "Speedzone Southern Herbicide": { division: "LO", subdivision: "Herbicide" },
  "Premise Foam": { division: "TERMITE", subdivision: "Foam" },
  "Evo Bait Station": { division: "RODENT", subdivision: "Station" },
  "PT Alpine": { division: "GHP", subdivision: "Aerosol/Contact" },
  "PT ALPINE WSG": { division: "GHP", subdivision: "General Insecticide" },
  "PT Microcare CS": { division: "GHP", subdivision: "General Insecticide" },
  "PT Phantom": { division: "GHP", subdivision: "Aerosol/Contact" },
  "PT Ultraside": { division: "GHP", subdivision: "Aerosol/Contact" },
  "PT wasp Freeze": { division: "GHP", subdivision: "Aerosol/Contact" },
  "Safari SG": { division: "LO", subdivision: "Ornamental Insecticide" },
  "Sector": { division: "MOSQUITO", subdivision: "Adulticide" },
  "Sedgehammer Turf Herbicide": { division: "LO", subdivision: "Herbicide" },
  "Shockwave": { division: "GHP", subdivision: "General Insecticide" },
  "Suspend SC": { division: "GHP", subdivision: "General Insecticide" },
  "Headway Fungicide": { division: "LO", subdivision: "Fungicide" },
  "Taurus SC": { division: "TERMITE", subdivision: "Liquid" },
  "Termidor Foam": { division: "TERMITE", subdivision: "Foam" },
  "Termidor SC": { division: "TERMITE", subdivision: "Liquid" },
  "Timbor": { division: "TERMITE", subdivision: "Wood/Borate" },
  "Top Choice": { division: "GHP", subdivision: "General Insecticide" },
  "Transport Mikron Insecticide": { division: "GHP", subdivision: "General Insecticide" },
  "T-Rex Snap Trap": { division: "RODENT", subdivision: "Trap" },
  "ULD BP-300": { division: "GHP", subdivision: "General Insecticide" },
  "Vendetta Plus": { division: "GHP", subdivision: "Bait" },
  "Extinguish Plus": { division: "GHP", subdivision: "Bait" },
  "Artavia 2SC Fungicide": { division: "LO", subdivision: "Fungicide" },
  "Lesco 25-0-10 Granular Fert": { division: "LO", subdivision: "Granular Fertilizer" },
  "Suspend PolyZone Insecticide": { division: "GHP", subdivision: "General Insecticide" },
  "Syngenta Heritage Granular Fungicide": { division: "LO", subdivision: "Fungicide" },
  "Victor M9 Pro Rat Trap": { division: "RODENT", subdivision: "Trap" },
  "Miscellaneous Chemical": { division: "OTHER", subdivision: "Misc" },
  "Miscellaneous Fertilizer": { division: "LO", subdivision: "Granular Fertilizer" },
  "Catchmaster PB Glue Board": { division: "RODENT", subdivision: "Trap" },
  "Precor 2000 Premise Spray": { division: "GHP", subdivision: "Aerosol/Contact" },
  "PT PI Pressurized Contact": { division: "GHP", subdivision: "Aerosol/Contact" },
  "Pageant Intrinsic Fungicide": { division: "LO", subdivision: "Fungicide" },
  "Roundup QuikPro Granular Herbicide": { division: "LO", subdivision: "Herbicide" },
  "Vector Fruit Fly Trap": { division: "GHP", subdivision: "Fly/Monitoring" },
  "Eaton Stick-Em Rat and Mouse": { division: "RODENT", subdivision: "Trap" },
  "Lesco 13-3-13 Spar-Tech": { division: "LO", subdivision: "Granular Fertilizer" },
  "Lesco 16-0-8 Spar Tech": { division: "LO", subdivision: "Granular Fertilizer" },
  "Lesco Macron Soluble Fertilizer": { division: "LO", subdivision: "Liquid Fertilizer" },
  "Promate 20-0-10": { division: "LO", subdivision: "Granular Fertilizer" },
  "Stop The Bites!": { division: "MOSQUITO", subdivision: "Barrier/Yard" },
};

/**
 * Owner's pack-size rule (Part B). Tube products (UoM code T) = 4 (4×30g tubes
 * per case); products sold individually and never by case (EA/RT/BS) = null (a
 * case pack size is meaningless); everything else = 12. Metadata only — no
 * conversion math runs on existing movements.
 */
function packSizeFor(code: string): number | null {
  const c = code.trim().toUpperCase();
  if (c === "T") return 4;
  if (c === "EA" || c === "RT" || c === "BS") return null;
  return 12;
}

// The 75 approved products, from the PestPac "Product list" sheet. `name` is the
// sheet's Product Name (a few reconciled so the alias map resolves exactly);
// `code` is the sheet's approved Unit Of Measure.
const APPROVED: ApprovedRow[] = [
  { name: "Lutz Perfect Spike", code: "T", material: "LUTZ PERFECT SPIKE", target: null, appMethod: null },
  { name: "Acephate 90 Prill", code: "J", material: "ACEPHATE 90 PRILL", target: "SHRUBS", appMethod: "SPRAYER" },
  { name: "Advion Ant Gel", code: "T", material: "ADVION ANT GEL", target: "ANTS", appMethod: "HAND" },
  { name: "Advion cockroach gel bait", code: "T", material: "ADVION COCKROACH GEL BAIT", target: "ROACHES", appMethod: "HAND" },
  { name: "Advion Insect Granular", code: "FB", material: "ADVION GRANULAR", target: "MILLIPEDE", appMethod: "SPREADER" },
  { name: "Advion WDG Insecticide", code: "OZ", material: "ADVION WDG", target: "ROACHES", appMethod: "SPRAYER" },
  { name: "Alpine Roach Gel Bait", code: "T", material: "ALPINE ROACH GEL BAIT", target: "ROACHES", appMethod: "HAND" },
  { name: "OTC Fungicide", code: "B", material: "OTC FUNGICIDE", target: null, appMethod: null },
  { name: "Archer IGR", code: "B", material: "ARCHER IGR", target: "ROACHES", appMethod: "SPRAYER" },
  { name: "Avenue South", code: "J", material: "AVENUE SOUTH", target: "BROADLEAF", appMethod: "SPRAYER" },
  { name: "bifen XTS", code: "J", material: "BIFEN XTS", target: "LAWN & SHURBS", appMethod: "SPRAYER" },
  { name: "CB-80 Insecticide", code: "AC", material: "CB-80 INSECTICIDE", target: "INSECTS", appMethod: "SPRAYER" },
  { name: "Celsius", code: "B", material: "CELSIUS", target: "WEEDS", appMethod: "SPRAYER" },
  { name: "Certainty", code: "B", material: "CERTAINTY", target: "WEEDS", appMethod: "SPRAYER" },
  { name: "Contrac Rodent Bait Blox", code: "BU", material: "CONTRAC RODENT BAIT BLOX", target: "RODENTS", appMethod: "HAND" },
  { name: "Cyper TC", code: "J", material: "CYPER TC", target: "PRE-TREATS", appMethod: "SPRAYER" },
  { name: "Delta dust", code: "B", material: "DELTA DUST", target: "INSECTS", appMethod: "SPRAYER" },
  { name: "Demand CS", code: "B", material: "DEMAND CS", target: "GHP", appMethod: "SPRAYER" },
  { name: "DIPEL PRO", code: "FB", material: "DIPEL PRO", target: "SHRUBS", appMethod: "SPRAYER" },
  { name: "Extinguish", code: "FB", material: "EXTINGUISH", target: "ANTS", appMethod: "SPREADER" },
  { name: "Gentrol IGR Concentrate", code: "B", material: "GENTROL IGR CONCENTRATE", target: "ROACHES", appMethod: "SPRAYER" },
  { name: "Invade Hot Spot", code: "AC", material: "INVADE HOT SPOT", target: "CLEANER", appMethod: "HAND" },
  { name: "19-19-19 Sprayable fertilizer", code: "FB", material: "FERTILIZER 19-19-19", target: "FERT", appMethod: "SPRAYER" },
  { name: "20-0-0 Liquid Fertilizer", code: "J", material: "LIQUID FERTILIZER 20-0-0", target: "FERT", appMethod: null },
  { name: "Fertilizer 24-0-11 (Turf)", code: "FB", material: "FERTILIZER - 24-0-11", target: "FERT", appMethod: "SPREADER" },
  { name: "33-0-17 Sprayable Fertilizer", code: "FB", material: "FERTILIZER  - 33-0-17", target: "FERT", appMethod: "SPRAYER" },
  { name: "Wasp & Hornet Spray", code: "AC", material: "WASP & HORNET SPRAY", target: "WASP", appMethod: "HAND" },
  { name: "Atrazine", code: "J", material: "ATRAZINE", target: "WEEDS", appMethod: "SPRAYER" },
  { name: "Bandit 2F", code: "J", material: "BANDIT 2F", target: "L-SHRUB", appMethod: "SPRAYER" },
  { name: "Lesco Bio Iron Plus", code: "J", material: "LESCO BIO IRON PLUS", target: "FERT", appMethod: "SPRAYER" },
  { name: "0-0-7 Fertilizer + Insecticide", code: "FB", material: "FERTILIZER + INSECT - 0-0-7", target: "ANTS / ROACH", appMethod: "SPREADER" },
  { name: "Crosscheck 0.069% Plus", code: "FB", material: "CROSSCHECK 0.069% PLUS", target: "ANTS / ROACHES", appMethod: "SPREADER" },
  { name: "CrossCheck Plus", code: "J", material: "CROSSCHECK PLUS", target: "GHP", appMethod: "SPRAYER" },
  { name: "Lesco 10-0-12", code: "FB", material: "LESCO 10-0-12", target: "FERT", appMethod: "SPREADER" },
  { name: "Lesco Fertilizer 13-0-0", code: "J", material: "LESCO FERTILIZER 13-0-0", target: "FERT", appMethod: "SPRAYER" },
  { name: "Fertilizer - 21-0-6", code: "FB", material: "FERTILIZER - 21-0-6", target: "FERT", appMethod: "SPREADER" },
  { name: "Fertilizer 8-0-10 (Shrub)", code: "FB", material: "FERTILIZER - 8-0-10", target: "FERT", appMethod: "HAND" },
  { name: "Lesco Liquid 0-0-25", code: "J", material: "LESCO LIQUID 0-0-25", target: "FERT", appMethod: null },
  { name: "20-20-20 Sprayable Fertilizer", code: "FB", material: "FERTILIZER 20-20-20", target: "FERT", appMethod: "SPRAYER" },
  { name: "Mansion Turf Herbicide", code: "B", material: "MANSION", target: "BROADLEAF", appMethod: "SPRAYER" },
  { name: "Blackout Fertilizer 0-0-18 (turf)", code: "FB", material: "FERTILIZER - 0-0-18", target: "FERT", appMethod: "SPREADER" },
  { name: "Prosecutor", code: "J", material: "PROSECUTOR", target: null, appMethod: null },
  { name: "Spreader Sticker", code: "J", material: "SPREADER STICKER", target: "LAWN & SHRUBS", appMethod: "SPRAYER" },
  { name: "Lesco T&O Chelated Liquid Fertilizer", code: "J", material: "LESCO T&O CHELATED LIQUID FERT", target: "FERT", appMethod: null },
  { name: "T-Storm Fungicide", code: "J", material: "T-STORM", target: "FUNGUS", appMethod: "SPRAYER" },
  { name: "Maxforce Complete Granular Bait", code: "FB", material: "MAXFORCE COMPLETE GRANULAR", target: null, appMethod: null },
  { name: "Maxforce Quantum Ant Bait", code: "T", material: "MAXFORCE QUANTUM ANT BAIT", target: "ANTS", appMethod: "HAND" },
  { name: "Arena Granular Insecticide", code: "FB", material: "ARENA", target: "CHINCH BUGS", appMethod: "SPREADER" },
  { name: "Optigard Ant Gel Bait", code: "T", material: "OPTIGARD ANT GEL BAIT", target: "ANTS", appMethod: "HAND" },
  { name: "Optigard Cockroach Gel Bait", code: "T", material: "OPTIGARD COCKROACH GEL BAIT", target: null, appMethod: null },
  { name: "Speedzone Southern Herbicide", code: "J", material: "SPEEDZONE SOUTHERN HERBICIDE", target: "WEEDS", appMethod: "SPRAYER" },
  { name: "Premise Foam", code: "AC", material: "PREMISE FOAM", target: null, appMethod: null },
  { name: "Evo Bait Station", code: "BS", material: "BAIT STATIONS", target: "RODENTS", appMethod: null },
  { name: "PT Alpine", code: "AC", material: "PT ALPINE", target: null, appMethod: null },
  { name: "PT ALPINE WSG", code: "B", material: "PT ALPINE WSG (BOTTLE)", target: null, appMethod: null },
  { name: "PT Microcare CS", code: "AC", material: "PT  MICROCARE CS", target: null, appMethod: "SPRAYER" },
  { name: "PT Phantom", code: "AC", material: "PT PHANTOM", target: null, appMethod: null },
  { name: "PT Ultraside", code: "AC", material: "PT ULTRASIDE", target: "Flea", appMethod: null },
  { name: "PT wasp Freeze", code: "AC", material: "PT WASP FREEZE", target: null, appMethod: null },
  { name: "Safari SG", code: "J", material: "SAFARI SG", target: null, appMethod: null },
  { name: "Sector", code: "J", material: "SECTOR", target: null, appMethod: null },
  { name: "Sedgehammer Turf Herbicide", code: "B", material: "SEDGEHAMMER", target: "NUTSEDGE", appMethod: "SPRAYER" },
  { name: "Shockwave", code: "J", material: "SHOCKWAVE", target: "INSECTS", appMethod: "FOGGER" },
  { name: "Suspend SC", code: "J", material: "SUSPEND SC", target: "ANTS / ROACHES", appMethod: "SPRAYER" },
  { name: "Headway Fungicide", code: "FB", material: "HEADWAY", target: "FUNGUS", appMethod: "SPREADER" },
  { name: "Taurus SC", code: "B", material: "TAURUS SC", target: "ANTS", appMethod: "SPRAYER" },
  { name: "Termidor Foam", code: "AC", material: "TERMIDOR FOAM", target: "TERMITES", appMethod: "HAND" },
  { name: "Termidor SC", code: "J", material: "TERMIDOR SC", target: "TERMITES", appMethod: "SPRAYER" },
  { name: "Timbor", code: "BU", material: "TIMBOR", target: "TERMITES", appMethod: "SPRAYER" },
  { name: "Top Choice", code: "FB", material: "TOP CHOICE", target: "FIRE ANTS", appMethod: "HAND" },
  { name: "Transport Mikron Insecticide", code: "B", material: "TRANSPORT MIKRON", target: "ANTS / ROACHES", appMethod: "SPRAYER" },
  { name: "T-Rex Snap Trap", code: "RT", material: "T-REX SNAP TRAP", target: "RATS", appMethod: "HAND" },
  { name: "ULD BP-300", code: "J", material: "ULD BP-300", target: "ROACHES", appMethod: "SPRYAER" },
  { name: "Vendetta Plus", code: "T", material: "VENDETTA PLUS", target: "ROACHES", appMethod: "HAND" },
  { name: "Extinguish Plus", code: "FB", material: "EXTINGUISH PLUS", target: "ANTS", appMethod: "SPREADER" },
];

// Products seen in the transfer history but NOT on the approved sheet. Added as
// approved (units taken from the history) and flagged via `notes` so HR/admin
// can confirm the naming before the history-load build.
const ADD_NOTE = "Added from transfer history — confirm naming with HR/admin.";
// Stable marker written when an admin DISCARDS a product from the confirm queue.
// The reconcile keys off this to keep it inactive/off-catalog across deploys.
// Must match the literal used by app/api/products/confirm (discard action).
const DISCARD_MARK = "Discarded from confirm queue";
// ADDED products stay confirmed=false (Part C) so the owner reviews the naming +
// enrichment before they go live. `manufacturer`/`activeIngredient` are FACTUAL
// label data (Part D); EPA numbers are deliberately left null (never guessed).
const ADDED: ApprovedRow[] = [
  { name: "Artavia 2SC Fungicide", code: "J", material: "ARTAVIA 2SC", target: "FUNGUS", appMethod: "SPRAYER", activeIngredient: "Azoxystrobin" },
  { name: "Lesco 25-0-10 Granular Fert", code: "FB", material: "LESCO 25-0-10", target: "FERT", appMethod: "SPREADER", manufacturer: "LESCO" },
  { name: "Suspend PolyZone Insecticide", code: "J", material: "SUSPEND POLYZONE", target: "GHP", appMethod: "SPRAYER", manufacturer: "Envu (Bayer)", activeIngredient: "Deltamethrin" },
  { name: "Syngenta Heritage Granular Fungicide", code: "FB", material: "HERITAGE GRANULAR", target: "FUNGUS", appMethod: "SPREADER", manufacturer: "Syngenta", activeIngredient: "Azoxystrobin" },
  { name: "Victor M9 Pro Rat Trap", code: "EA", material: "VICTOR M9 PRO", target: "RATS", appMethod: "HAND", manufacturer: "Woodstream (Victor)" },
  { name: "Miscellaneous Chemical", code: "J", material: "MISC CHEMICAL", target: null, appMethod: null },
  { name: "Miscellaneous Fertilizer", code: "FB", material: "MISC FERTILIZER", target: null, appMethod: null },
  // Phase 2: genuinely-missing products found in the 4-branch transfer histories.
  // UoM code is taken from the received unit in that branch's transfer rows.
  { name: "Catchmaster PB Glue Board", code: "RT", material: "CATCHMASTER PB GLUE BOARD", target: "RODENTS", appMethod: "HAND", manufacturer: "AP&G (Catchmaster)" }, // Orlando
  { name: "Precor 2000 Premise Spray", code: "AC", material: "PRECOR 2000 PREMISE SPRAY 16 O", target: "FLEA", appMethod: "SPRAYER", manufacturer: "Zoecon (Central Life Sciences)", activeIngredient: "Permethrin + (S)-Methoprene" }, // Orlando
  { name: "PT PI Pressurized Contact", code: "AC", material: "PT PI PRESSURIZED CONTACT", target: "INSECTS", appMethod: "SPRAYER", manufacturer: "BASF" }, // Orlando
  { name: "Pageant Intrinsic Fungicide", code: "B", material: "PAGEANT INTRINSIC FUNGICIDE", target: "FUNGUS", appMethod: "SPRAYER", manufacturer: "BASF", activeIngredient: "Pyraclostrobin + Boscalid" }, // Stuart
  { name: "Roundup QuikPro Granular Herbicide", code: "J", material: "ROUNDUP QUIKRO  GRAN HERBICIDE", target: "WEEDS", appMethod: "SPRAYER", manufacturer: "Envu (Bayer)", activeIngredient: "Glyphosate + Diquat dibromide" }, // Stuart + Vero
  { name: "Vector Fruit Fly Trap", code: "C", material: "960 VECTOR FRUIT FLY TRAP", target: "FLIES", appMethod: "HAND" }, // Vero (history UoM = Case)
  { name: "Eaton Stick-Em Rat and Mouse", code: "RT", material: "EATON STICK-EM RAT AND MOUSE", target: "RODENTS", appMethod: "HAND", manufacturer: "J.T. Eaton" }, // Vero
  { name: "Lesco 13-3-13 Spar-Tech", code: "FB", material: "LESCO 13-3-13 SPAR-TECH T&O GR", target: "FERT", appMethod: "SPREADER", manufacturer: "LESCO" }, // Vero
  { name: "Lesco 16-0-8 Spar Tech", code: "FB", material: "LESCO 16-0-8 SPAR TECH", target: "FERT", appMethod: "SPREADER", manufacturer: "LESCO" }, // Vero
  { name: "Lesco Macron Soluble Fertilizer", code: "BU", material: "LESCO MACRON SOLUBLE FERTILIZE", target: "FERT", appMethod: null, manufacturer: "LESCO" }, // Vero
  { name: "Promate 20-0-10", code: "FB", material: "PROMATE 20-0-10", target: "FERT", appMethod: "SPREADER" }, // Vero
  { name: "Stop The Bites!", code: "J", material: "STOP THE BITES!", target: "INSECTS", appMethod: "SPRAYER", manufacturer: "Control Solutions Inc.", enrichNote: "Active ingredient not verified — confirm from label before go-live." }, // Vero
];

// Part F — a single generic catalog line for non-chemical purchases (gloves,
// hose reels, tools, PPE, shop/office supplies). Confirmed + approved; the
// invoice reader / history loader routes clearly non-chemical items here.
export const NON_CHEMICAL_PRODUCT_NAME = "Non-Chemical Purchase";
const NON_CHEMICAL: ApprovedRow = {
  name: NON_CHEMICAL_PRODUCT_NAME,
  code: "EA",
  material: "NON-CHEMICAL PURCHASE",
  target: null,
  appMethod: null,
  division: "OTHER",
  subdivision: "Non-Chemical",
};
const NON_CHEMICAL_NOTE = "Generic line for non-chemical purchases (gloves, hose reels, equipment).";

// A reconcile row carries an optional base note and its confirmation state.
type ReconcileRow = ApprovedRow & { note?: string; confirmed: boolean; baseNote?: string };

export async function seedApprovedProducts(prisma: PrismaClient) {
  const all: ReconcileRow[] = [
    ...APPROVED.map((a) => ({ ...a, confirmed: true })),
    // ADDED products stay unconfirmed (Part C) until an admin confirms them.
    ...ADDED.map((a) => ({ ...a, baseNote: ADD_NOTE, confirmed: false })),
    { ...NON_CHEMICAL, baseNote: NON_CHEMICAL_NOTE, confirmed: true },
  ];

  // Existing products, indexed by normalized name (the stable upsert key).
  const existing = await prisma.product.findMany();
  const byNorm = new Map(existing.map((p) => [normalizeProductName(p.name), p]));
  const approvedNorms = new Set<string>();

  let created = 0;
  let updated = 0;
  for (const row of all) {
    const norm = normalizeProductName(row.name);
    approvedNorms.add(norm);
    const code = isUomCode(row.code) ? row.code.toUpperCase() : "EA";
    const category = categorizeProduct(row.name, row.activeIngredient ?? "", row.target ?? "", code);
    const found = byNorm.get(norm);

    // Line-of-service classification (authoritative; overwrite on every run).
    const cls = CLASSIFICATION[row.name];
    const { division, subdivision } = normalizeClassification(
      row.division ?? cls?.division ?? null,
      row.subdivision ?? cls?.subdivision ?? null
    );
    const unitsPerCase = packSizeFor(code);

    // Compose notes: base note (ADD / non-chemical) + any enrichment note,
    // appended so nothing already there is clobbered. (No classification-flag
    // note — the owner has finalized the map.)
    const noteParts: string[] = [];
    if (row.baseNote) noteParts.push(row.baseNote);
    if (row.enrichNote) noteParts.push(row.enrichNote);
    const composedNote = noteParts.length ? noteParts.join(" ") : null;

    if (found) {
      // Preserve an admin's confirmation: an ADDED row is only (re)asserted
      // unconfirmed while still pristine (its ADD note intact). Once confirmed
      // in-app the note is rewritten, so we keep the stored value.
      const pristine = (found.notes ?? "").includes(ADD_NOTE);
      const confirmed = row.confirmed ? true : (pristine ? false : found.confirmed);
      // A product an admin DISCARDED from the confirm queue stays off — don't
      // resurrect it (active/approved) on the next deploy.
      const discarded = (found.notes ?? "").includes(DISCARD_MARK);
      await prisma.product.update({
        where: { id: found.id },
        data: {
          unitOfMeasure: code,
          approved: discarded ? false : true,
          active: discarded ? false : true,
          confirmed: discarded ? true : confirmed,
          category: found.category ?? category,
          division,
          subdivision,
          unitsPerCase,
          targetPest: found.targetPest ?? row.target ?? null,
          applicationMethod: found.applicationMethod ?? row.appMethod ?? null,
          manufacturer: found.manufacturer ?? row.manufacturer ?? null,
          activeIngredient: found.activeIngredient ?? row.activeIngredient ?? null,
          // Keep an existing distributor SKU; otherwise stamp the PestPac code.
          distributorSku: found.distributorSku ?? row.material,
          // Only (re)write the note while pristine, so an admin's edits survive.
          ...(composedNote && pristine ? { notes: composedNote } : {}),
        },
      });
      updated++;
    } else {
      await prisma.product.create({
        data: {
          name: row.name,
          unitOfMeasure: code,
          approved: true,
          confirmed: row.confirmed,
          category,
          division,
          subdivision,
          unitsPerCase,
          targetPest: row.target ?? null,
          applicationMethod: row.appMethod ?? null,
          manufacturer: row.manufacturer ?? null,
          activeIngredient: row.activeIngredient ?? null,
          distributorSku: row.material,
          notes: composedNote,
        },
      });
      created++;
    }
  }

  // Everything not on the approved list is off-catalog: still usable, flagged.
  const offList = existing.filter((p) => !approvedNorms.has(normalizeProductName(p.name)));
  let demoted = 0;
  for (const p of offList) {
    if (p.approved) {
      await prisma.product.update({ where: { id: p.id }, data: { approved: false } });
      demoted++;
    }
  }

  return { created, updated, demoted, approvedTotal: all.length };
}

// Allow running directly against local dev.db: `tsx prisma/seed-products-approved.ts`
async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    // Prove on-hand is untouched: StockMovement count must be identical.
    const mvBefore = await prisma.stockMovement.count();
    console.log(`StockMovement count BEFORE seed = ${mvBefore}`);

    const r = await seedApprovedProducts(prisma);
    console.log(`approved-products seed: ${r.created} created, ${r.updated} updated, ${r.demoted} demoted to off-catalog.`);

    const approvedCount = await prisma.product.count({ where: { approved: true } });
    const confirmedCount = await prisma.product.count({ where: { approved: true, confirmed: true } });
    const unconfirmedCount = await prisma.product.count({ where: { confirmed: false } });
    console.log(`catalog: ${approvedCount} approved (${confirmedCount} confirmed) · ${unconfirmedCount} unconfirmed (confirm queue)`);

    // Division rollup: distinct classified products per division.
    const classified = await prisma.product.findMany({
      where: { division: { not: null } },
      select: { division: true, subdivision: true },
    });
    const byDiv = new Map<string, Map<string, number>>();
    for (const p of classified) {
      const d = p.division ?? "—";
      if (!byDiv.has(d)) byDiv.set(d, new Map());
      const subs = byDiv.get(d)!;
      const s = p.subdivision ?? "—";
      subs.set(s, (subs.get(s) ?? 0) + 1);
    }
    console.log("division rollup (distinct products):");
    for (const [d, subs] of [...byDiv.entries()].sort()) {
      const total = [...subs.values()].reduce((a, b) => a + b, 0);
      console.log(`  ${d}: ${total}`);
      for (const [s, n] of [...subs.entries()].sort()) console.log(`      ${s}: ${n}`);
    }

    const mvAfter = await prisma.stockMovement.count();
    console.log(`StockMovement count AFTER seed  = ${mvAfter}  (${mvAfter === mvBefore ? "UNCHANGED ✓" : "CHANGED ✗"})`);

    const checks = ["Advion Ant Gel", "Sector", "Stop The Bites!", "Lutz Perfect Spike", "Non-Chemical Purchase", "Victor M9 Pro Rat Trap"];
    for (const name of checks) {
      const p = await prisma.product.findFirst({ where: { name }, select: { name: true, unitOfMeasure: true, unitsPerCase: true, approved: true, confirmed: true, division: true, subdivision: true } });
      console.log(`  ${name} -> ${p ? `${p.division}/${p.subdivision} · ${p.unitOfMeasure} (packSize=${p.unitsPerCase}) approved=${p.approved} confirmed=${p.confirmed}` : "MISSING"}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when invoked as a script, not when imported by deploy-db.
if (process.argv[1] && /seed-products-approved\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
