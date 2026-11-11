import "server-only";
import { prisma } from "@/lib/prisma";
import { scoreInspection, parseJson, criticalFailures, isServiceAdvisorDriver, isAdvisorName, type Ratings, type Checks } from "@/lib/inspection";
import { matchEmployeeByName } from "@/lib/people";

// Runtime healer: re-score every stored vehicle inspection under the current
// Section A point rule (lib/inspection.ts `conditionPoints`).
//
// The COO changed the grading in Nov 2026: "Meets" and "Exceeds" now both earn
// the full 3 points per condition item and only "Below standards" is penalized.
// Inspections filed before that (notably October 2026, which feeds the rolling
// technician grades and the quarterly review) stored score / scorePct / grade
// computed under the old rule (Meets = 2 pts), so an all-Meets, all-pass truck
// read 16/20 = 80% (B) instead of 20/20 (A). This recomputes those columns from
// each row's stored raw `ratings` / `checks` JSON with the current
// `scoreInspection`. Only rows whose computed values differ are updated; the raw
// ratings/checks, photos, and critical-failure alerts (checks-only) are untouched.
//
// Idempotent: guarded by the Setting marker `inspection_rescore_v1` (written only
// after a successful pass) plus an in-memory flag, so it runs once. Re-running is
// harmless anyway — recomputed values already match. Non-fatal.

const MARKER_KEY = "inspection_rescore_v1";
let _ran = false;

export async function ensureInspectionsRescored(): Promise<void> {
  if (_ran) return;
  try {
    const marker = await prisma.setting.findUnique({ where: { key: MARKER_KEY } });
    if (marker) {
      _ran = true;
      return;
    }

    const rows = await prisma.vehicleInspection.findMany({
      select: { id: true, ratings: true, checks: true, score: true, maxScore: true, scorePct: true, grade: true },
    });

    let updated = 0;
    for (const r of rows) {
      const next = scoreInspection(parseJson<Ratings>(r.ratings, {}), parseJson<Checks>(r.checks, {}));
      if (
        next.score === r.score &&
        next.maxScore === r.maxScore &&
        next.scorePct === r.scorePct &&
        next.grade === r.grade
      ) continue;
      await prisma.vehicleInspection.update({
        where: { id: r.id },
        data: { score: next.score, maxScore: next.maxScore, scorePct: next.scorePct, grade: next.grade },
      });
      updated++;
    }

    await prisma.setting.upsert({
      where: { key: MARKER_KEY },
      update: { value: new Date().toISOString() },
      create: { key: MARKER_KEY, value: new Date().toISOString() },
    });
    _ran = true;
    console.log(`ensureInspectionsRescored: re-scored ${updated} of ${rows.length} inspection(s) under the Meets = full-points rule.`);
  } catch (e) {
    console.error("ensureInspectionsRescored failed (non-fatal):", e);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Service-advisor re-score (COO 2026-11-11). Advisors / salespeople carry no
// toolbox, PPE, pesticides, lawn signs or spray equipment and have no truck bed,
// so those items are N/A on an advisor's vehicle (lib/inspection.ts itemApplies).
// Inspections already filed for advisors were graded out of 20 with those items
// counted as failures (e.g. ~60% instead of 100%). This re-scores every stored
// inspection whose graded driver is a service advisor under the advisor profile
// (out of 9), and clears / rewrites the critical-safety alert when its only
// "critical failures" were N/A items. Raw ratings/checks and photos are kept.
// Non-fatal; no emails are sent.

// Runs as a cheap self-heal (not one-time): the advisor rule can only become
// MORE complete (e.g. a profile fixed in HR, a vehicle re-linked), so every pass
// re-checks all inspections. Throttled to once per server instance per 10 min;
// writes only rows whose stored grade is wrong. The first version (marker
// inspection_rescore_advisor_v1) missed advisors whose profile didn't read as an
// advisor — e.g. Josh Flagg's #48, still at 60%.
const ADVISOR_REPORT_KEY = "inspection_rescore_advisor_report";
const THROTTLE_MS = 10 * 60 * 1000;
let _advisorAt = 0;
let _advisorRun: Promise<void> | null = null;

export function ensureAdvisorInspectionsRescored(force = false): Promise<void> {
  if (!force && _advisorRun) return _advisorRun;
  if (!force && Date.now() - _advisorAt < THROTTLE_MS) return Promise.resolve();
  _advisorRun = (async () => {
    try {
      const res = await rescoreAdvisorInspections();
      _advisorAt = Date.now();
      if (res.rescored > 0 || res.alertsCleared > 0) {
        const value = JSON.stringify({ at: new Date().toISOString(), ...res });
        await prisma.setting.upsert({ where: { key: ADVISOR_REPORT_KEY }, update: { value }, create: { key: ADVISOR_REPORT_KEY, value } });
        console.log(`ensureAdvisorInspectionsRescored: ${res.rescored} advisor inspection(s) re-scored, ${res.alertsCleared} critical alert(s) cleared (${res.advisors.join(", ")}).`);
      }
    } catch (e) {
      console.error("ensureAdvisorInspectionsRescored failed (non-fatal):", e);
    } finally {
      _advisorRun = null;
    }
  })();
  return _advisorRun;
}

/** Exported for the dev test script. */
export async function rescoreAdvisorInspections(): Promise<{ rescored: number; alertsCleared: number; advisors: string[] }> {
  const [rows, employees] = await Promise.all([
    prisma.vehicleInspection.findMany({
      select: {
        id: true, vehicleId: true, year: true, month: true, branch: true, employeeId: true, technicianName: true,
        ratings: true, checks: true, score: true, maxScore: true, scorePct: true, grade: true,
        vehicle: { select: { assignedEmployeeId: true, assignedTo: true } },
      },
    }),
    prisma.employee.findMany({ select: { id: true, name: true, nickname: true, role: true, title: true, division: true, branch: true, user: { select: { accessLevel: true } } } }),
  ]);
  const advisorIds = new Set(
    employees.filter((e) => isServiceAdvisorDriver({ ...e, accessLevel: e.user?.accessLevel ?? null })).map((e) => e.id),
  );
  const lite = employees.map((e) => ({ id: e.id, name: e.name, nickname: e.nickname, role: e.role, division: e.division, branch: e.branch }));
  const branchLite = (b: string | null) => lite.filter((e) => !b || e.branch === b);

  let rescored = 0;
  let alertsCleared = 0;
  const advisors = new Set<string>();
  for (const r of rows) {
    // Advisor if the graded employee, the vehicle's assigned driver, or the
    // recorded names resolve to a service advisor.
    const gradedId = r.employeeId ?? matchEmployeeByName(r.technicianName, branchLite(r.branch));
    const driverId = r.vehicle?.assignedEmployeeId ?? matchEmployeeByName(r.vehicle?.assignedTo, branchLite(r.branch));
    const isAdvisor =
      (!!gradedId && advisorIds.has(gradedId)) ||
      (!!driverId && advisorIds.has(driverId)) ||
      isAdvisorName(r.technicianName) ||
      isAdvisorName(r.vehicle?.assignedTo);
    if (!isAdvisor) continue;
    advisors.add(r.technicianName ?? r.vehicle?.assignedTo ?? r.id);
    const ratings = parseJson<Ratings>(r.ratings, {});
    const checks = parseJson<Checks>(r.checks, {});
    const next = scoreInspection(ratings, checks, "advisor");
    if (next.score !== r.score || next.maxScore !== r.maxScore || next.scorePct !== r.scorePct || next.grade !== r.grade) {
      await prisma.vehicleInspection.update({
        where: { id: r.id },
        data: { score: next.score, maxScore: next.maxScore, scorePct: next.scorePct, grade: next.grade },
      });
      rescored++;
    }
    // Critical-safety alert: keep only failures that still apply to an advisor.
    const dedupeKey = `inspection_critical:${r.vehicleId}:${r.year}-${String(r.month).padStart(2, "0")}`;
    const fails = criticalFailures(checks, "advisor");
    if (fails.length === 0) {
      const d = await prisma.alert.deleteMany({ where: { dedupeKey } });
      alertsCleared += d.count;
    } else {
      const a = await prisma.alert.findUnique({ where: { dedupeKey } });
      const msg = a ? `${a.message.split(":")[0]}: ${fails.length} critical inspection failure${fails.length === 1 ? "" : "s"} — ${fails.map((f) => f.label).join("; ")}.` : null;
      if (a && msg && a.message !== msg) await prisma.alert.update({ where: { dedupeKey }, data: { message: msg } });
    }
  }
  return { rescored, alertsCleared, advisors: [...advisors] };
}
