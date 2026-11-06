import "server-only";
import { prisma } from "@/lib/prisma";
import { scoreInspection, parseJson, type Ratings, type Checks } from "@/lib/inspection";

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
