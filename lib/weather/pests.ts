// Weather Ops — Pest & Agronomic Pressure engine. Maps SEASON (month) + weather
// signals (temp / rain / humidity) to ELEVATED pest & turf-disease pressure for the
// Treasure Coast + Central FL, with a GENERAL ops recommendation per signal. Grounded
// in the in-house entomologist reference (Florida pests/turf). Pure + unit-tested.
//
// Compliance (FL 482): recommendations stay operational — scout / inspect / communicate
// / service focus. They never prescribe a specific product or application rate. This is
// a likelihood/pressure guide from weather + season, NOT a diagnosis.

export type PressureDomain = "turf-disease" | "turf-pest" | "general" | "mosquito" | "rodent" | "flea-tick" | "termite";
export type PressureLevel = "elevated" | "watch";

export type PressureCard = {
  key: string;
  domain: PressureDomain;
  title: string;
  level: PressureLevel;
  driver: string; // the weather/season reason
  rec: string; // general ops recommendation
};

export type PestInput = {
  month: number; // 1–12 (ET)
  tempF: number | null; // representative daytime temp
  humidity: number | null; // relative humidity %
  rainActive: boolean; // raining today or a wet stretch ahead
  dry: boolean; // a dry stretch (low rain chance)
  heavyRain: boolean; // heavy rain / flooding signal
};

const inMonths = (m: number, list: number[]) => list.includes(m);
const DOMAIN_LABEL: Record<PressureDomain, string> = {
  "turf-disease": "Lawn disease",
  "turf-pest": "Lawn pest",
  general: "General pest",
  mosquito: "Mosquito",
  rodent: "Rodent",
  "flea-tick": "Flea / tick",
  termite: "Termite",
};
export const pressureDomainLabel = (d: PressureDomain) => DOMAIN_LABEL[d];

/**
 * Compute elevated/watch pest & agronomic pressures for a territory-day. Elevated
 * cards come first. Temp-gated rules only fire when a temperature is available; a few
 * seasonal rules (e.g. winter rodents) fire on month alone.
 */
export function pestPressure(i: PestInput): PressureCard[] {
  const cards: PressureCard[] = [];
  const t = i.tempF;
  const h = i.humidity;
  const add = (c: PressureCard) => cards.push(c);

  // ---------------- Lawn / turf DISEASE ----------------
  // Large/Brown patch (Rhizoctonia) — mild temps + wet/humid, fall & spring. The
  // classic "cooler than 80 with rain" fungus window.
  if (t != null && t < 85 && (i.rainActive || (h != null && h >= 80)) && inMonths(i.month, [3, 4, 5, 10, 11, 12])) {
    add({ key: "large_patch", domain: "turf-disease", level: "elevated", title: "Large / brown patch",
      driver: `Mild temps (<85°F) with ${i.rainActive ? "rain" : "high humidity"} in ${monthName(i.month)} — prime Rhizoctonia window`,
      rec: "Scout St. Augustine/zoysia for circular patches with an orange halo; time preventative turf fungicide; avoid evening irrigation." });
  }
  // Gray leaf spot — hot + humid summer on St. Augustine.
  if (t != null && t >= 85 && h != null && h >= 75 && inMonths(i.month, [6, 7, 8, 9])) {
    add({ key: "gray_leaf_spot", domain: "turf-disease", level: "elevated", title: "Gray leaf spot",
      driver: "Summer heat + high humidity on St. Augustine", rec: "Hold heavy summer nitrogen; scout for oblong gray lesions on St. Augustine." });
  }
  // Pythium / take-all — heavy rain in the warm season.
  if (i.heavyRain && t != null && t >= 82 && inMonths(i.month, [6, 7, 8, 9])) {
    add({ key: "pythium", domain: "turf-disease", level: "watch", title: "Pythium / heat-stress disease",
      driver: "Heavy rain + heat", rec: "Watch low/wet turf areas for greasy collapse; improve drainage; note Pythium needs a specialty fungicide." });
  }
  if ((i.rainActive || (h != null && h >= 80)) && inMonths(i.month, [3, 4, 5, 10, 11]) && t != null && t < 85) {
    add({ key: "take_all", domain: "turf-disease", level: "watch", title: "Take-all root rot",
      driver: "Wet spring/fall soils", rec: "Yellow, thinning turf that won't green up — check for rotted roots/loose stolons." });
  }

  // ---------------- Turf PESTS ----------------
  // Chinch bugs — hot + DRY, St. Augustine, warm season.
  if (t != null && t >= 85 && i.dry && inMonths(i.month, [4, 5, 6, 7, 8, 9, 10])) {
    add({ key: "chinch", domain: "turf-pest", level: "elevated", title: "Chinch bugs",
      driver: "Hot, dry stretch", rec: "Scout sunny, dry St. Augustine edges that won't recover with water; confirm with a flotation test." });
  }
  // Sod webworm / armyworm — after warm-season rains.
  if (i.rainActive && t != null && t >= 78 && inMonths(i.month, [7, 8, 9, 10, 11])) {
    add({ key: "webworm", domain: "turf-pest", level: "watch", title: "Sod webworm / armyworm",
      driver: "Warm-season rainfall", rec: "Watch for sudden defoliation and birds pecking turf; scout at dusk." });
  }
  // Mole cricket nymphs — early-mid summer.
  if (inMonths(i.month, [6, 7, 8]) && t != null && t >= 80) {
    add({ key: "mole_cricket", domain: "turf-pest", level: "watch", title: "Mole cricket nymphs",
      driver: "Summer nymph window", rec: "Soap-flush Bahia/bermuda to confirm; nymphs are the treatable stage." });
  }

  // ---------------- General / occasional invaders ----------------
  // American roaches (palmetto bugs) — warm + wet drives them in/around homes.
  if (t != null && t >= 80 && i.rainActive) {
    add({ key: "american_roach", domain: "general", level: "elevated", title: "American roach (palmetto) activity",
      driver: "Warm + wet — rain pushes roaches toward structures", rec: "Expect more exterior/occasional-invader calls; focus perimeter, harborage, and drains; tell customers it's weather-driven, not sanitation." });
  }
  // Ghost / white-footed ants — dry stretches push foraging indoors.
  if (t != null && t >= 78 && i.dry) {
    add({ key: "ghost_ants", domain: "general", level: "watch", title: "Ghost / white-footed ants",
      driver: "Dry, warm stretch expands indoor foraging", rec: "Use a non-repellent transfer approach (repellents scatter the colony); check exterior plants for the tending source." });
  }
  // Silverfish/booklice — sustained high humidity.
  if (h != null && h >= 82 && t != null && t >= 72) {
    add({ key: "humidity_pests", domain: "general", level: "watch", title: "Humidity pests (silverfish, booklice)",
      driver: "Sustained high humidity", rec: "Check damp areas (baths, garages, storage); advise ventilation/dehumidification." });
  }

  // ---------------- Mosquitoes ----------------
  if (i.rainActive && t != null && t >= 72) {
    add({ key: "mosquito", domain: "mosquito", level: "elevated", title: "Mosquito breeding",
      driver: "Rain + warmth create standing-water breeding sites", rec: "Prioritize source reduction (standing water) and exterior/larval focus; advise customers to dump containers." });
  }

  // ---------------- Rodents ----------------
  // Cooler months push roof rats indoors; food habits shift to structures.
  if (inMonths(i.month, [11, 12, 1, 2]) || (t != null && t < 62)) {
    add({ key: "roof_rat", domain: "rodent", level: "elevated", title: "Roof rat intrusion",
      driver: "Cooler weather pushes roof rats indoors from the roofline; they shift to interior food/harborage", rec: "Exclusion-first: inspect rooflines, soffits, palms touching the roof; set customer expectations on sounds-in-ceiling before interior trapping." });
  }
  if (i.heavyRain) {
    add({ key: "rodent_flush", domain: "rodent", level: "watch", title: "Rodent displacement (flooding)",
      driver: "Heavy rain / flooding displaces ground rodents", rec: "Expect Norway rat movement from burrows/sewers; inspect ground-level entry after heavy rain." });
  }

  // ---------------- Fleas / ticks ----------------
  if (t != null && t >= 70 && h != null && h >= 70 && inMonths(i.month, [3, 4, 5, 6, 7, 8, 9, 10, 11])) {
    add({ key: "flea_tick", domain: "flea-tick", level: "watch", title: "Fleas / ticks",
      driver: "Warm + humid accelerates the flea lifecycle", rec: "Yard + pet-rest-area focus; remind customers to treat pets concurrently or control fails." });
  }

  // ---------------- Subterranean termite swarming ----------------
  // Native/Asian Feb–Apr, Formosan Apr–Jun; swarms triggered by warm spring rain.
  if (i.rainActive && t != null && t >= 75 && inMonths(i.month, [2, 3, 4])) {
    add({ key: "subterranean_swarm", domain: "termite", level: "elevated", title: "Subterranean termite swarm",
      driver: "Warm spring rain triggers Eastern/Asian subterranean swarms", rec: "Expect swarmers near windows/lights; capture photos, save wings, and offer a WDO inspection." });
  }
  if (i.rainActive && t != null && t >= 78 && inMonths(i.month, [4, 5, 6])) {
    add({ key: "formosan_swarm", domain: "termite", level: "elevated", title: "Formosan termite swarm",
      driver: "Warm, humid evenings with rain — Formosan swarm season", rec: "High-aggression species — prioritize WDO inspections; recommend colony-elimination baiting where active." });
  }

  // Elevated first, then watch; stable order within each.
  return cards.sort((a, b) => (a.level === b.level ? 0 : a.level === "elevated" ? -1 : 1));
}

function monthName(m: number): string {
  return ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m] ?? "";
}
