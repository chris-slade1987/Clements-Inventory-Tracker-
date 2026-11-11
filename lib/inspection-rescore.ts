import "server-only";
import { prisma } from "@/lib/prisma";
import { scoreInspection, parseJson, criticalFailures, isServiceAdvisorDriver, type Ratings, type Checks } from "@/lib/inspection";
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
// Once (Setting marker), non-fatal; no emails are sent.

const ADVISOR_MARKER_KEY = "inspection_rescore_advisor_v1";
let _advisorRan = false;

export async function ensureAdvisorInspectionsRescored(): Promise<void> {
  if (_advisorRan) return;
  try {
    if (await prisma.setting.findUnique({ where: { key: ADVISOR_MARKER_KEY } })) { _advisorRan = true; return; }
    const res = await rescoreAdvisorInspections();
    await prisma.setting.upsert({
      where: { key: ADVISOR_MARKER_KEY },
      update: { value: JSON.stringify({ at: new Date().toISOString(), ...res }) },
      create: { key: ADVISOR_MARKER_KEY, value: JSON.stringify({ at: new Date().toISOString(), ...res }) },
    });
    _advisorRan = true;
    console.log(`ensureAdvisorInspectionsRescored: ${res.rescored} advisor inspection(s) re-scored, ${res.alertsCleared} critical alert(s) cleared.`);
  } catch (e) {
    console.error("ensureAdvisorInspectionsRescored failed (non-fatal):", e);
  }
}

/** Exported for the dev test script. */
export async function rescoreAdvisorInspections(): Promise<{ rescored: number; alertsCleared: number; advisors: string[] }> {
  const [rows, employees] = await Promise.all([
    prisma.vehicleInspection.findMany({
      select: { id: true, vehicleId: true, year: true, month: true, branch: true, employeeId: true, technicianName: true, ratings: true, checks: true, score: true, maxScore: true, scorePct: true, grade: true },
    }),
    prisma.employee.findMany({ select: { id: true, name: true, nickname: true, role: true, division: true, branch: true, user: { select: { accessLevel: true } } } }),
  ]);
  const advisorIds = new Set(
    employees.filter((e) => isServiceAdvisorDriver({ role: e.role, accessLevel: e.user?.accessLevel ?? null })).map((e) => e.id),
  );
  const lite = employees.map((e) => ({ id: e.id, name: e.name, nickname: e.nickname, role: e.role, division: e.division, branch: e.branch }));

  let rescored = 0;
  let alertsCleared = 0;
  const advisors = new Set<string>();
  for (const r of rows) {
    const empId = r.employeeId ?? matchEmployeeByName(r.technicianName, lite.filter((e) => !r.branch || e.branch === r.branch));
    if (!empId || !advisorIds.has(empId)) continue;
    advisors.add(r.technicianName ?? empId);
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
      if (a) {
        const label = a.message.split(":")[0];
        await prisma.alert.update({
          where: { dedupeKey },
          data: { message: `${label}: ${fails.length} critical inspection failure${fails.length === 1 ? "" : "s"} — ${fails.map((f) => f.label).join("; ")}.` },
        });
      }
    }
  }
  return { rescored, alertsCleared, advisors: [...advisors] };
}
