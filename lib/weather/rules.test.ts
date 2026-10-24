// Weather Ops rules-engine tests — one case per flag + the risk-level logic.
// Run: npx tsx --test lib/weather/rules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFlags, riskLevel, grade, resolveThresholds, inBlackout, DEFAULT_THRESHOLDS } from "./rules";
import type { GridData, HourPoint, RulesInput, WxAlert } from "./types";

const DATE = "2026-07-15";
const T = DEFAULT_THRESHOLDS;

// Build an hour at a given local ET hour on DATE.
function hr(hour: number, over: Partial<HourPoint> = {}): HourPoint {
  const hh = String(hour).padStart(2, "0");
  return {
    time: `${DATE}T${hh}:00:00-04:00`,
    tempF: 88,
    pop: 0,
    windMph: 5,
    windDir: "E",
    gustMph: 8,
    short: "Sunny",
    thunder: false,
    ...over,
  };
}
const EMPTY_GRID: GridData = { qpf24In: 0, maxGustMph: 8, maxHeatIndexF: 90, thunderHours: [] };
function input(over: Partial<RulesInput> = {}): RulesInput {
  return {
    hourly: [hr(8), hr(12), hr(16)],
    grid: EMPTY_GRID,
    alerts: [],
    tropicalActive: false,
    date: DATE,
    blackout: false,
    ...over,
  };
}
const codes = (i: RulesInput) => computeFlags(i, T).map((f) => f.code);
function alert(event: string, severity = "Severe"): WxAlert {
  return { event, severity, headline: event, description: "", onset: null, ends: null };
}

test("baseline calm day → no flags, green", () => {
  const i = input();
  assert.deepEqual(codes(i), []);
  assert.equal(riskLevel(computeFlags(i, T), i, T), "green");
});

test("RAIN_WINDOW fires at/above pop threshold, lists hours", () => {
  const i = input({ hourly: [hr(8, { pop: 20 }), hr(14, { pop: 60 })] });
  const flags = computeFlags(i, T);
  const rw = flags.find((f) => f.code === "RAIN_WINDOW");
  assert.ok(rw, "RAIN_WINDOW present");
  assert.deepEqual(rw!.hours, [`${DATE}T14:00:00-04:00`]);
  // just-below threshold does not fire
  assert.ok(!codes(input({ hourly: [hr(14, { pop: 49 })] })).includes("RAIN_WINDOW"));
});

test("HEAVY_RAIN fires at ≥ 2.0in / 24h", () => {
  assert.ok(codes(input({ grid: { ...EMPTY_GRID, qpf24In: 2.0 } })).includes("HEAVY_RAIN"));
  assert.ok(!codes(input({ grid: { ...EMPTY_GRID, qpf24In: 1.9 } })).includes("HEAVY_RAIN"));
});

test("FERT_ALERT_BLOCK fires on flood/tropical/hurricane watch or warning", () => {
  assert.ok(codes(input({ alerts: [alert("Flood Watch")] })).includes("FERT_ALERT_BLOCK"));
  assert.ok(codes(input({ alerts: [alert("Tropical Storm Warning")] })).includes("FERT_ALERT_BLOCK"));
  assert.ok(!codes(input({ alerts: [alert("Air Quality Alert")] })).includes("FERT_ALERT_BLOCK"));
});

test("WIND_CAUTION fires on sustained ≥10 or gust ≥15", () => {
  assert.ok(codes(input({ hourly: [hr(10, { windMph: 10 })] })).includes("WIND_CAUTION"));
  assert.ok(codes(input({ grid: { ...EMPTY_GRID, maxGustMph: 15 } })).includes("WIND_CAUTION"));
  assert.ok(!codes(input({ hourly: [hr(10, { windMph: 9, gustMph: 14 })], grid: { ...EMPTY_GRID, maxGustMph: 14 } })).includes("WIND_CAUTION"));
});

test("WIND_NO_SPRAY fires on sustained ≥15", () => {
  assert.ok(codes(input({ hourly: [hr(10, { windMph: 15 })] })).includes("WIND_NO_SPRAY"));
  assert.ok(!codes(input({ hourly: [hr(10, { windMph: 14 })] })).includes("WIND_NO_SPRAY"));
});

test("THUNDER fires from short text OR gridpoint hours", () => {
  assert.ok(codes(input({ hourly: [hr(15, { short: "Scattered Thunderstorms", thunder: true })] })).includes("THUNDER"));
  assert.ok(codes(input({ grid: { ...EMPTY_GRID, thunderHours: [`${DATE}T15:00:00-04:00`] } })).includes("THUNDER"));
});

test("HEAT_HIGH at 103–115, HEAT_EXTREME above 115 (not both)", () => {
  const high = codes(input({ grid: { ...EMPTY_GRID, maxHeatIndexF: 104 } }));
  assert.ok(high.includes("HEAT_HIGH") && !high.includes("HEAT_EXTREME"));
  const extreme = codes(input({ grid: { ...EMPTY_GRID, maxHeatIndexF: 116 } }));
  assert.ok(extreme.includes("HEAT_EXTREME") && !extreme.includes("HEAT_HIGH"));
  assert.ok(!codes(input({ grid: { ...EMPTY_GRID, maxHeatIndexF: 102 } })).includes("HEAT_HIGH"));
});

test("NWS_WARNING fires on any Warning event", () => {
  assert.ok(codes(input({ alerts: [alert("Severe Thunderstorm Warning") ] })).includes("NWS_WARNING"));
  assert.ok(!codes(input({ alerts: [alert("Heat Advisory")] })).includes("NWS_WARNING"));
});

test("TROPICAL fires on NHC storm or tropical watch/warning", () => {
  assert.ok(codes(input({ tropicalActive: true })).includes("TROPICAL"));
  assert.ok(codes(input({ alerts: [alert("Hurricane Watch")] })).includes("TROPICAL"));
});

test("FERT_BLACKOUT is info-only and never elevates risk", () => {
  const i = input({ blackout: true });
  const flags = computeFlags(i, T);
  assert.ok(flags.some((f) => f.code === "FERT_BLACKOUT" && f.level === "info"));
  assert.equal(riskLevel(flags, i, T), "green");
});

test("risk: a plain yellow flag → yellow", () => {
  const i = input({ hourly: [hr(14, { pop: 70 })] });
  assert.equal(grade(i, T).risk, "yellow");
});

test("risk: NWS_WARNING / TROPICAL / HEAT_EXTREME → red", () => {
  assert.equal(grade(input({ alerts: [alert("Flood Warning")] }), T).risk, "red");
  assert.equal(grade(input({ tropicalActive: true }), T).risk, "red");
  assert.equal(grade(input({ grid: { ...EMPTY_GRID, maxHeatIndexF: 120 } }), T).risk, "red");
});

test("risk: THUNDER + rain over half the 7am–5pm workday → red", () => {
  // 10 workday hours (7..16); make 6 rainy AND thundery.
  const hours: HourPoint[] = [];
  for (let h = 7; h < 17; h++) hours.push(hr(h, h < 13 ? { pop: 80, thunder: true, short: "Thunderstorms" } : {}));
  const i = input({ hourly: hours });
  assert.equal(grade(i, T).risk, "red");
});

test("risk: THUNDER with rain over only part of the workday → yellow", () => {
  const hours: HourPoint[] = [];
  for (let h = 7; h < 17; h++) hours.push(hr(h, h < 10 ? { pop: 80, thunder: true, short: "Thunderstorms" } : {}));
  const i = input({ hourly: hours });
  assert.equal(grade(i, T).risk, "yellow");
});

test("resolveThresholds merges partials over defaults", () => {
  const t = resolveThresholds({ rainPopPct: 40 });
  assert.equal(t.rainPopPct, 40);
  assert.equal(t.heatExtremeF, DEFAULT_THRESHOLDS.heatExtremeF);
  assert.deepEqual(resolveThresholds(null), DEFAULT_THRESHOLDS);
});

test("custom threshold changes the flag outcome", () => {
  const i = input({ hourly: [hr(14, { pop: 45 })] });
  assert.ok(!codes(i).includes("RAIN_WINDOW")); // default 50
  assert.ok(computeFlags(i, resolveThresholds({ rainPopPct: 40 })).some((f) => f.code === "RAIN_WINDOW"));
});

test("inBlackout handles normal and year-wrapping windows", () => {
  assert.ok(inBlackout("06-15", "06-01", "08-31"));
  assert.ok(!inBlackout("09-01", "06-01", "08-31"));
  assert.ok(inBlackout("01-10", "12-01", "02-01")); // wraps year-end
  assert.ok(!inBlackout("03-01", "12-01", "02-01"));
});

test("only hours on the target date are graded", () => {
  const other = hr(14, { pop: 90 });
  other.time = `2026-07-16T14:00:00-04:00`; // tomorrow
  assert.ok(!codes(input({ hourly: [other] })).includes("RAIN_WINDOW"));
});
