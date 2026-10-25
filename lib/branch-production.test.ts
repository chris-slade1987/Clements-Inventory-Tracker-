// Branch production/pacing engine tests. Run: npx tsx --test lib/branch-production.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRouteProduction, computeBranchProduction, type SchedStop, type ProductionInput } from "./branch-production";

const TODAY = "2026-10-25";

// Route 26 / ROB: 15 stops on 10/01–10/15 (past), 5 on 10/27–10/31 (future).
function buildSchedule(): SchedStop[] {
  const stops: SchedStop[] = [];
  for (let i = 1; i <= 15; i++) stops.push({ account: `a${i}`, route: "26", techName: "ROB", date: `2026-10-${String(i).padStart(2, "0")}`, dollars: 100 });
  for (let i = 16; i <= 20; i++) stops.push({ account: `a${i}`, route: "26", techName: "ROB", date: `2026-10-${27 + (i - 16)}`, dollars: 100 });
  return stops;
}
function baseInput(over: Partial<ProductionInput> = {}): ProductionInput {
  return {
    today: TODAY,
    scheduled: buildSchedule(),
    completed: Array.from({ length: 13 }, (_, k) => ({ account: `a${k + 1}`, dollars: 110 })), // a1..a13 done
    cancellations: [],
    newStarts: [],
    ...over,
  };
}

test("completion by count and $", () => {
  const [r] = computeRouteProduction(baseInput());
  assert.equal(r.scheduledCount, 20);
  assert.equal(r.completedCount, 13);
  assert.equal(r.completionPct, 65);
  assert.equal(r.scheduledDollars, 2000);
  assert.equal(r.completedDollars, 13 * 110); // production $ from the production report
});

test("pace is judged against the day-level schedule (not a flat %)", () => {
  const [r] = computeRouteProduction(baseInput());
  assert.equal(r.expectedByTodayCount, 15); // 15 stops scheduled on/before the 25th
  assert.equal(r.expectedPct, 75);
  assert.equal(r.completionPct, 65);
  assert.equal(r.paceDeltaPct, -10); // 10 points behind where the schedule says we should be
  assert.equal(r.status, "behind");
});

test("jobs left behind = past-due, not done, not moved", () => {
  const [r] = computeRouteProduction(baseInput());
  // a14, a15 are past-due (10/14, 10/15) and not completed.
  assert.equal(r.leftBehindCount, 2);
  assert.deepEqual(r.leftBehind.map((x) => x.account).sort(), ["a14", "a15"]);
});

test("rescheduled accounts are NOT counted as left behind", () => {
  const [r] = computeRouteProduction(baseInput({ rescheduledAccounts: ["a14"] }));
  assert.equal(r.leftBehindCount, 1);
  assert.deepEqual(r.leftBehind.map((x) => x.account), ["a15"]);
});

test("underserviced report cross-checks (catches a report-only past-due)", () => {
  const [r] = computeRouteProduction(baseInput({ underservicedPastDue: [{ account: "z9", route: "26", date: "2026-10-08" }] }));
  assert.ok(r.leftBehind.some((x) => x.account === "z9"));
  assert.equal(r.leftBehindCount, 3); // a14, a15, z9
});

test("remaining = future-dated, not yet done", () => {
  const [r] = computeRouteProduction(baseInput());
  assert.equal(r.remainingCount, 5); // a16..a20
  assert.equal(r.remainingDollars, 500);
});

test("projection from the route's own throughput; behind route won't finish", () => {
  const [r] = computeRouteProduction(baseInput());
  // dailyRate 13/15 over 5 remaining days ≈ +4.3 → ~17.3/20 ≈ 86–87%
  assert.ok(r.projectedCompletionPct >= 85 && r.projectedCompletionPct <= 88, `got ${r.projectedCompletionPct}`);
  assert.equal(r.projectedStatus, "wont_finish");
});

test("route size change = new starts minus cancellations (not sales)", () => {
  const [r] = computeRouteProduction(baseInput({
    cancellations: [{ account: "a3", route: "26", dollars: 95 }],
    newStarts: [{ account: "n1", route: "26", dollars: 120 }, { account: "n2", route: "26", dollars: 120 }],
  }));
  assert.equal(r.cancellations, 1);
  assert.equal(r.newStarts, 2);
  assert.equal(r.netRouteChange, 1);
  assert.equal(r.netRouteChangeDollars, 120 + 120 - 95);
});

test("a fully on-time route reads on_pace / on_track", () => {
  const sched = buildSchedule();
  const completed = sched.filter((s) => s.date <= TODAY).map((s) => ({ account: s.account, dollars: 100 })); // all past done
  const [r] = computeRouteProduction({ today: TODAY, scheduled: sched, completed, cancellations: [], newStarts: [] });
  assert.equal(r.leftBehindCount, 0);
  assert.equal(r.status, "on_pace");
  assert.equal(r.projectedStatus, "on_track");
});

test("branch rollup sums routes", () => {
  const b = computeBranchProduction(baseInput());
  assert.equal(b.totals.scheduledCount, 20);
  assert.equal(b.totals.completedCount, 13);
  assert.equal(b.totals.leftBehindCount, 2);
  assert.equal(b.routes.length, 1);
});
