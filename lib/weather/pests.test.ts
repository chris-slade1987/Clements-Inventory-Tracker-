// Pest & Agronomic Pressure engine tests. Run: npx tsx --test lib/weather/pests.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pestPressure, type PestInput } from "./pests";

const base: PestInput = { month: 6, tempF: 85, humidity: 70, rainActive: false, dry: false, heavyRain: false };
const keys = (i: Partial<PestInput>) => pestPressure({ ...base, ...i }).map((c) => c.key);

test("winter, <80°F with rain → brown/large patch (user example)", () => {
  assert.ok(keys({ month: 12, tempF: 74, rainActive: true, humidity: 85 }).includes("large_patch"));
  // warmer than the window → not fired by this rule
  assert.ok(!keys({ month: 12, tempF: 90, rainActive: true }).includes("large_patch"));
});

test("summer rain + warm → American roach activity (user example)", () => {
  assert.ok(keys({ month: 7, tempF: 86, rainActive: true }).includes("american_roach"));
  assert.ok(!keys({ month: 7, tempF: 86, rainActive: false, dry: true }).includes("american_roach"));
});

test("winter → roof rat intrusion elevated (user example)", () => {
  assert.ok(keys({ month: 1, tempF: 60 }).includes("roof_rat"));
  assert.ok(keys({ month: 7, tempF: 58 }).includes("roof_rat")); // cold snap also triggers
  assert.ok(!keys({ month: 7, tempF: 88 }).includes("roof_rat"));
});

test("hot + dry warm season → chinch bugs", () => {
  assert.ok(keys({ month: 5, tempF: 90, dry: true }).includes("chinch"));
  assert.ok(!keys({ month: 5, tempF: 90, dry: false, rainActive: true }).includes("chinch"));
});

test("rain + warmth → mosquito breeding", () => {
  assert.ok(keys({ month: 8, tempF: 84, rainActive: true }).includes("mosquito"));
  assert.ok(!keys({ month: 1, tempF: 55, rainActive: false }).includes("mosquito"));
});

test("hot + humid summer → gray leaf spot", () => {
  assert.ok(keys({ month: 8, tempF: 90, humidity: 80 }).includes("gray_leaf_spot"));
  assert.ok(!keys({ month: 8, tempF: 90, humidity: 55 }).includes("gray_leaf_spot"));
});

test("warm spring rain → subterranean termite swarm", () => {
  assert.ok(keys({ month: 3, tempF: 78, rainActive: true }).includes("subterranean_swarm"));
  assert.ok(keys({ month: 5, tempF: 82, rainActive: true }).includes("formosan_swarm"));
  assert.ok(!keys({ month: 11, tempF: 78, rainActive: true }).includes("subterranean_swarm"));
});

test("heavy rain → rodent displacement watch", () => {
  assert.ok(keys({ month: 9, tempF: 84, heavyRain: true, rainActive: true }).includes("rodent_flush"));
});

test("elevated cards sort before watch", () => {
  const cards = pestPressure({ month: 12, tempF: 74, humidity: 85, rainActive: true, dry: false, heavyRain: false });
  const firstWatch = cards.findIndex((c) => c.level === "watch");
  const lastElevated = cards.map((c) => c.level).lastIndexOf("elevated");
  if (firstWatch !== -1 && lastElevated !== -1) assert.ok(lastElevated < firstWatch);
});

test("missing temperature only fires season-only rules", () => {
  const k = keys({ month: 1, tempF: null, humidity: null, rainActive: false, dry: false });
  assert.ok(k.includes("roof_rat")); // winter, season-only
  assert.ok(!k.includes("chinch")); // temp-gated, skipped
});
