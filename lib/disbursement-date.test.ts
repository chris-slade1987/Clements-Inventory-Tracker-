// Check-Out "Date taken" rules.
// Run: npx tsx --test lib/disbursement-date.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { etTodayKey, resolveDisbursedAt, shiftDayKey, earliestDisbursementKey } from "./disbursement-date";

// 2026-11-23 15:00 UTC = 10:00 ET on Nov 23.
const NOW = new Date("2026-11-23T15:00:00Z");

test("today in ET, including late-evening UTC rollover", () => {
  assert.equal(etTodayKey(NOW), "2026-11-23");
  // 03:30 UTC on Nov 24 is still 10:30 pm ET on Nov 23.
  assert.equal(etTodayKey(new Date("2026-11-24T03:30:00Z")), "2026-11-23");
});

test("empty or today keeps the real time", () => {
  for (const raw of [undefined, "", "2026-11-23"]) {
    const r = resolveDisbursedAt(raw, NOW);
    assert.ok(!("error" in r));
    assert.equal(r.backdated, false);
    assert.equal(r.at.getTime(), NOW.getTime());
  }
});

test("a past day is stamped at midday ET on that day", () => {
  const r = resolveDisbursedAt("2026-11-20", NOW);
  assert.ok(!("error" in r));
  assert.equal(r.backdated, true);
  assert.equal(r.at.toISOString(), "2026-11-20T17:00:00.000Z");
  assert.equal(etTodayKey(r.at), "2026-11-20");
});

test("future, malformed and too-old dates are refused", () => {
  assert.ok("error" in resolveDisbursedAt("2026-11-24", NOW));
  assert.ok("error" in resolveDisbursedAt("2026-02-30", NOW));
  assert.ok("error" in resolveDisbursedAt("11/20/2026", NOW));
  assert.equal(earliestDisbursementKey(NOW), "2026-10-24");
  assert.ok(!("error" in resolveDisbursedAt("2026-10-24", NOW)));
  assert.ok("error" in resolveDisbursedAt("2026-10-23", NOW));
});

test("calendar shift crosses month boundaries", () => {
  assert.equal(shiftDayKey("2026-12-01", -1), "2026-11-30");
  assert.equal(shiftDayKey("2026-11-23", -30), "2026-10-24");
});
