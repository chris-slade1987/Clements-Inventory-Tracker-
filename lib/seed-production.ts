import "server-only";
import { prisma } from "@/lib/prisma";
import octSeed from "@/prisma/data/seed-production-2026-10.json";
import novSeed from "@/prisma/data/seed-production-2026-11.json";

// Production-data seed for Branch Command route-completion months.
//
// Branch Command's route completion is normally populated by a manager uploading the
// six PestPac reports (/api/branch-command/production). That upload writes to whichever
// database the app runs on — so a FRESH production database (Postgres on Vercel) starts
// empty even though the data was ingested locally. This healer carries the already-
// computed months (RouteMonth + LeftBehindJob + the upload manifest) so the deployed app
// shows them immediately, with no manual re-upload. Mirrors the other ensure* healers
// (ensureMbrLoaded / ensureWeatherLoaded) in app/(app)/layout.tsx.
//
// Months carried:
//   2026-10 — full six-report ingest (real completion data).
//   2026-11 — baseline plan from the PestPac Appointment List (forward-looking; completion
//             0 until the live production reports are uploaded during/after November).
//
// REVISIONED PER MONTH. Each seed carries a `revision`; the Setting
// `production_seed_rev:<periodKey>` records the revision last applied. On boot:
//   - marker === seed.revision  → nothing to do (fast path).
//   - otherwise                 → REPLACE the period (delete its three tables + reload)
//                                 and stamp the marker to the new revision.
// This lets a corrected seed (e.g. the Nov routing re-export → revision 2) actually land
// in a prod DB that already holds the earlier revision — the old `if (existing>0) skip`
// could never do that. A plain idempotent re-run is still a no-op (marker already matches),
// so a live manager upload is only ever replaced by a DELIBERATE revision bump in the repo.
// Best-effort: any error is swallowed so it can never block a page render.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProductionSeed = any;
const SEEDS: ProductionSeed[] = [octSeed, novSeed];

let done = false;

export async function ensureProductionSeed(): Promise<void> {
  if (done) return;
  try {
    for (const seed of SEEDS) {
      try {
        const rev = String(seed.revision ?? 1);
        const markerKey = `production_seed_rev:${seed.periodKey}`;
        const marker = await prisma.setting.findUnique({ where: { key: markerKey } });
        if (marker?.value === rev) continue; // already at this revision — leave live data alone

        // (Re)load this month: replace its rows, then stamp the revision. All-or-nothing so a
        // partial seed can't let a manager sign a week with jobs silently dropped.
        await prisma.$transaction([
          prisma.routeMonth.deleteMany({ where: { periodKey: seed.periodKey } }),
          prisma.leftBehindJob.deleteMany({ where: { periodKey: seed.periodKey } }),
          prisma.productionReportUpload.deleteMany({ where: { periodKey: seed.periodKey } }),
          prisma.routeMonth.createMany({
            data: (seed.routeMonth as ProductionSeed[]).map((r) => ({
              ...r,
              computedAt: r.computedAt ? new Date(r.computedAt) : undefined,
            })),
          }),
          prisma.leftBehindJob.createMany({
            data: (seed.leftBehindJob as ProductionSeed[]).map((r) => ({
              ...r,
              scheduledDate: r.scheduledDate ? new Date(r.scheduledDate) : null,
            })),
          }),
          prisma.productionReportUpload.createMany({
            data: (seed.productionReportUpload as ProductionSeed[]).map((r) => ({
              ...r,
              uploadedById: r.uploadedById ?? null,
              uploadedByName: r.uploadedByName ?? null,
              uploadedAt: r.uploadedAt ? new Date(r.uploadedAt) : undefined,
            })),
          }),
          prisma.setting.upsert({ where: { key: markerKey }, update: { value: rev }, create: { key: markerKey, value: rev } }),
        ]);
      } catch {
        // best-effort per month; a failure on one month must not block the others
      }
    }
    done = true;
  } catch {
    // best-effort; never block render
  }
}
