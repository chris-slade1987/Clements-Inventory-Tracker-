// Weather Ops — the DETERMINISTIC ops rules engine. This runs BEFORE the AI and is
// the single source of truth for flags + risk level. The AI only explains what this
// computes; it never sets the risk. Pure module (no server-only) so it is unit-tested
// directly. See docs/WEATHER-OPS.md and lib/weather/rules.test.ts.

import type { Flag, RiskLevel, RulesInput, Thresholds, WxAlert } from "./types";

export const DEFAULT_THRESHOLDS: Thresholds = {
  rainPopPct: 50,
  heavyRainIn: 2.0,
  windCautionMph: 10,
  windGustCautionMph: 15,
  windNoSprayMph: 15,
  heatHighF: 103,
  heatExtremeF: 115,
};

/** Merge stored partial thresholds over the code defaults (missing keys → default). */
export function resolveThresholds(partial?: Partial<Thresholds> | null): Thresholds {
  return { ...DEFAULT_THRESHOLDS, ...(partial ?? {}) };
}

// The service workday used for the red-day rain/thunder test: 7am–5pm local (ET).
// NWS returns local ISO times, so the hour is the first two digits after "T".
const WORK_START = 7;
const WORK_END = 17; // exclusive — hours 7..16 (10 slots)

/** Local (ET) hour from an NWS ISO timestamp, which already carries the local offset. */
export function localHour(iso: string): number {
  return Number(iso.slice(11, 13));
}
/** Local (ET) date ("YYYY-MM-DD") from an NWS ISO timestamp. */
export function localDate(iso: string): string {
  return iso.slice(0, 10);
}

function isWarningEvent(e: string): boolean {
  return /\bwarning\b/i.test(e);
}
function isTropicalEvent(e: string): boolean {
  return /(hurricane|tropical storm|tropical depression|storm surge)/i.test(e) && /(watch|warning)/i.test(e);
}
function isFertBlockingAlert(a: WxAlert): boolean {
  return /(flood|tropical storm|hurricane)/i.test(a.event) && /(watch|warning)/i.test(a.event);
}

function maxOf(nums: (number | null | undefined)[]): number | null {
  const vals = nums.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return vals.length ? Math.max(...vals) : null;
}

/**
 * Compute every ops flag for a territory-day. Order is stable (reading order).
 * `hours` on rain/thunder flags lists the affected local hours of the target date.
 */
export function computeFlags(input: RulesInput, thresholds: Thresholds): Flag[] {
  const t = thresholds;
  const flags: Flag[] = [];

  // Hours for the target date only (grading today).
  const todayHours = input.hourly.filter((h) => localDate(h.time) === input.date);

  // RAIN_WINDOW — any hour today at/above the pop threshold.
  const rainHours = todayHours.filter((h) => h.pop >= t.rainPopPct).map((h) => h.time);
  if (rainHours.length > 0) {
    flags.push({
      code: "RAIN_WINDOW",
      level: "yellow",
      label: "Rain window",
      meaning: "Liquid lawn and perimeter apps may wash off; schedule them before that hour.",
      hours: rainHours,
    });
  }

  // HEAVY_RAIN — forecast total within 24h.
  if (input.grid.qpf24In != null && input.grid.qpf24In >= t.heavyRainIn) {
    flags.push({
      code: "HEAVY_RAIN",
      level: "yellow",
      label: "Heavy rain",
      meaning: "No fertilizer apps.",
    });
  }

  // FERT_ALERT_BLOCK — active flood/tropical-storm/hurricane watch or warning.
  if (input.alerts.some(isFertBlockingAlert)) {
    flags.push({
      code: "FERT_ALERT_BLOCK",
      level: "yellow",
      label: "Fertilizer block (alert)",
      meaning: "No fertilizer apps.",
    });
  }

  // Wind — sustained (hourly windMph high-end) and gusts.
  const sustained = maxOf(todayHours.map((h) => h.windMph));
  const gust = maxOf([input.grid.maxGustMph, ...todayHours.map((h) => h.gustMph)]);
  if ((sustained != null && sustained >= t.windCautionMph) || (gust != null && gust >= t.windGustCautionMph)) {
    flags.push({
      code: "WIND_CAUTION",
      level: "yellow",
      label: "Wind caution",
      meaning: "Drift risk; check labels and favor granular apps.",
    });
  }
  if (sustained != null && sustained >= t.windNoSprayMph) {
    flags.push({
      code: "WIND_NO_SPRAY",
      level: "yellow",
      label: "Hold liquid spray",
      meaning: "Hold liquid spray apps.",
    });
  }

  // THUNDER — hourly short text (precise hours) or the gridpoint thunder signal. The
  // affected hours come from the hourly text; the gridpoint is a boolean fallback.
  const thunderHours = todayHours.filter((h) => h.thunder).map((h) => h.time).sort();
  if (thunderHours.length > 0 || input.grid.thunderLikely) {
    flags.push({
      code: "THUNDER",
      level: "yellow",
      label: "Thunderstorms",
      meaning: "Stop outdoor work during those hours; front-load routes.",
      ...(thunderHours.length > 0 ? { hours: thunderHours } : {}),
    });
  }

  // Heat index.
  const heat = input.grid.maxHeatIndexF;
  if (heat != null && heat > t.heatExtremeF) {
    flags.push({
      code: "HEAT_EXTREME",
      level: "red",
      label: "Extreme heat",
      meaning: "Adjust crew schedule.",
    });
  } else if (heat != null && heat >= t.heatHighF) {
    flags.push({
      code: "HEAT_HIGH",
      level: "yellow",
      label: "High heat",
      meaning: "Mandatory breaks and water.",
    });
  }

  // NWS warnings (any active Warning → red).
  if (input.alerts.some((a) => isWarningEvent(a.event))) {
    flags.push({
      code: "NWS_WARNING",
      level: "red",
      label: "NWS warning",
      meaning: "Red day.",
    });
  }

  // Tropical (NHC storm affecting FL, or a tropical watch/warning → red).
  if (input.tropicalActive || input.alerts.some((a) => isTropicalEvent(a.event))) {
    flags.push({
      code: "TROPICAL",
      level: "red",
      label: "Tropical system",
      meaning: "Red day; expect cancellations and reschedules.",
    });
  }

  // Fertilizer blackout — reminder only, never elevates risk.
  if (input.blackout) {
    flags.push({
      code: "FERT_BLACKOUT",
      level: "info",
      label: "Fertilizer blackout",
      meaning: "Date falls inside the territory's fertilizer blackout window (reminder only).",
    });
  }

  return flags;
}

/**
 * Risk level from the flags + the hourly rain pattern.
 * - RED: any NWS_WARNING / TROPICAL / HEAT_EXTREME, OR THUNDER with rain covering
 *   more than half of the 7am–5pm workday.
 * - YELLOW: any other flag except FERT_BLACKOUT (which is reminder-only).
 * - GREEN: no risk-elevating flags.
 */
export function riskLevel(flags: Flag[], input: RulesInput, thresholds: Thresholds): RiskLevel {
  const has = (c: string) => flags.some((f) => f.code === c);

  // Hard red flags.
  if (has("NWS_WARNING") || has("TROPICAL") || has("HEAT_EXTREME")) return "red";

  // THUNDER + rain over more than half the workday → red.
  if (has("THUNDER")) {
    const workHours = input.hourly.filter(
      (h) => localDate(h.time) === input.date && localHour(h.time) >= WORK_START && localHour(h.time) < WORK_END
    );
    const total = workHours.length || WORK_END - WORK_START;
    const rainy = workHours.filter((h) => h.pop >= thresholds.rainPopPct).length;
    if (rainy > total / 2) return "red";
  }

  // Any non-info (non-blackout) flag → yellow.
  if (flags.some((f) => f.level !== "info")) return "yellow";

  return "green";
}

/** Convenience: flags + risk in one call. */
export function grade(input: RulesInput, thresholds: Thresholds): { flags: Flag[]; risk: RiskLevel } {
  const flags = computeFlags(input, thresholds);
  return { flags, risk: riskLevel(flags, input, thresholds) };
}

/** Is a "MM-DD" date inside a [start, end] "MM-DD" window (inclusive; wraps year-end)? */
export function inBlackout(monthDay: string, startMonthDay: string, endMonthDay: string): boolean {
  const n = (md: string) => { const [m, d] = md.split("-").map(Number); return m * 100 + d; };
  const x = n(monthDay), s = n(startMonthDay), e = n(endMonthDay);
  return s <= e ? x >= s && x <= e : x >= s || x <= e; // wrap (e.g. Dec→Jan)
}

export const WORKDAY = { start: WORK_START, end: WORK_END };
