// Weather Ops — shared, PURE types (no server-only import) so the rules engine and
// its tests can run outside Next. See docs/WEATHER-OPS.md.

export type RiskLevel = "green" | "yellow" | "red";

/** One hour of the hourly forecast, normalized from NWS forecastHourly. */
export type HourPoint = {
  time: string; // ISO with local offset, e.g. "2026-10-24T07:00:00-04:00"
  tempF: number | null;
  pop: number; // precipitation probability 0–100
  humidity: number | null; // relative humidity %
  windMph: number | null; // high end of the sustained-wind range
  windDir: string | null;
  gustMph: number | null;
  short: string; // shortForecast text
  thunder: boolean; // short text mentions thunder
};

/** One NWS forecast period (day/night) for the 5-day strip. */
export type DayPoint = {
  name: string; // "Today", "Tonight", "Saturday", ...
  isDaytime: boolean;
  tempF: number | null;
  short: string;
  pop: number | null;
  icon: string | null;
};

/** Trimmed gridpoint detail — only the fields the rules engine uses. */
export type GridData = {
  qpf24In: number | null; // max forecast precip (inches) in any rolling 24h ahead
  maxGustMph: number | null; // peak wind gust ahead
  maxHeatIndexF: number | null; // peak heat index ahead
  thunderLikely: boolean; // gridpoint thunder/lightning probability > 0 for today (ET)
};

/** An active NWS alert, trimmed. */
export type WxAlert = {
  event: string; // "Tropical Storm Warning", "Flood Watch", ...
  severity: string; // "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown"
  headline: string;
  description: string;
  onset: string | null;
  ends: string | null;
};

/** A computed ops flag. `level` drives risk; "info" never elevates risk. */
export type Flag = {
  code: FlagCode;
  level: "info" | "yellow" | "red";
  label: string;
  meaning: string;
  hours?: string[]; // affected hours, when relevant (rain/thunder)
};

export type FlagCode =
  | "RAIN_WINDOW"
  | "HEAVY_RAIN"
  | "FERT_ALERT_BLOCK"
  | "WIND_CAUTION"
  | "WIND_NO_SPRAY"
  | "THUNDER"
  | "HEAT_HIGH"
  | "HEAT_EXTREME"
  | "NWS_WARNING"
  | "TROPICAL"
  | "FERT_BLACKOUT";

/** Admin-editable rule thresholds. */
export type Thresholds = {
  rainPopPct: number; // RAIN_WINDOW: pop ≥ this in any hour
  heavyRainIn: number; // HEAVY_RAIN: forecast inches within 24h
  windCautionMph: number; // WIND_CAUTION: sustained ≥ this
  windGustCautionMph: number; // WIND_CAUTION: gusts ≥ this
  windNoSprayMph: number; // WIND_NO_SPRAY: sustained ≥ this
  heatHighF: number; // HEAT_HIGH: heat index ≥ this (and ≤ extreme)
  heatExtremeF: number; // HEAT_EXTREME: heat index > this
};

/** Input to the rules engine (already normalized from the providers). */
export type RulesInput = {
  hourly: HourPoint[];
  grid: GridData;
  alerts: WxAlert[];
  tropicalActive: boolean; // NHC: a storm is affecting Florida
  date: string; // "YYYY-MM-DD" (ET) — the day we're grading
  blackout: boolean; // today falls inside this territory's fert blackout
};

/** The structured AI ops briefing. */
export type BriefingContent = {
  headline: string;
  summary: string;
  bestWorkWindow: string;
  byServiceLine: { lawn: string; pest: string; termite: string };
  crewSafety: string;
  lookAhead: string;
};
