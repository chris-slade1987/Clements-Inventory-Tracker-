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
//   2026-11 — baseline plan from the Technician Schedule Report only (the month hasn't
//             started, so everything is scheduled/forward-looking; completion is 0 until
//             the live production reports are uploaded during/after November).
//
// Idempotent PER MONTH: a period that already has rows (e.g. a manager later uploads the
// live November reports) is skipped, so this never clobbers real data. Best-effort: any
// error is swallowed so it can never block a page render.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProductionSeed = any;
const SEEDS: ProductionSeed[] = [octSeed, novSeed];

let done = false;

export async function ensureProductionSeed(): Promise<void> {
  if (done) return;
  try {
    for (const seed of SEEDS) {
      try {
        const existing = await prisma.routeMonth.count({ where: { periodKey: seed.periodKey } });
        if (existing > 0) continue; // month already present — never overwrite real uploads

        // All-or-nothing per month: a partial seed (routes without their left-behind jobs)
        // would let a manager sign a week with jobs silently dropped, so wrap the three
        // inserts in one transaction.
        await prisma.$transaction([
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
