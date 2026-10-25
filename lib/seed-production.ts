import "server-only";
import { prisma } from "@/lib/prisma";
import seed from "@/prisma/data/seed-production-2026-10.json";

// One-time production-data seed for the October 2026 route-completion month.
//
// Branch Command's route completion is normally populated by a manager uploading the
// six PestPac reports (/api/branch-command/production). That upload writes to whichever
// database the app runs on — so a FRESH production database (Postgres on Vercel) starts
// empty even though the data was ingested locally. This healer carries the already-
// computed October month (RouteMonth + LeftBehindJob + the upload manifest) so the
// deployed app shows it immediately, with no manual re-upload. Mirrors the other
// ensure* healers (ensureMbrLoaded / ensureWeatherLoaded) in app/(app)/layout.tsx.
//
// Idempotent: if the period already has rows (e.g. a manager later re-uploads), it does
// nothing. Best-effort: any error is swallowed so it can never block a page render.
// This is a bootstrap convenience for the first deploy — once the live monthly upload
// flow is in use it can be removed.
let done = false;

export async function ensureProductionSeed(): Promise<void> {
  if (done) return;
  try {
    const existing = await prisma.routeMonth.count({ where: { periodKey: seed.periodKey } });
    if (existing > 0) { done = true; return; }

    // All-or-nothing: a partial seed (routes without their left-behind jobs) would let a
    // manager sign a week with hundreds of jobs silently dropped, so wrap the three inserts
    // in one transaction.
    await prisma.$transaction([
      prisma.routeMonth.createMany({
        data: seed.routeMonth.map((r) => ({
          ...r,
          computedAt: r.computedAt ? new Date(r.computedAt) : undefined,
        })),
      }),
      prisma.leftBehindJob.createMany({
        data: seed.leftBehindJob.map((r) => ({
          ...r,
          scheduledDate: r.scheduledDate ? new Date(r.scheduledDate) : null,
        })),
      }),
      prisma.productionReportUpload.createMany({
        data: seed.productionReportUpload.map((r) => ({
          ...r,
          uploadedById: r.uploadedById ?? null,
          uploadedByName: r.uploadedByName ?? null,
          uploadedAt: r.uploadedAt ? new Date(r.uploadedAt) : undefined,
        })),
      }),
    ]);
    done = true;
  } catch {
    // best-effort; never block render
  }
}
