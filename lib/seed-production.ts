import "server-only";
import { prisma } from "@/lib/prisma";
import { snapshotAddressed, applyAddressed } from "@/lib/left-behind-carry";
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
//   2026-11 — revision 6 = the same data as revision 5, re-issued with retry + error
//             recording after rev 5 never showed in production (COO 11/23).
//   (prior) revision 5 (COO 11/23): month-to-date as of Mon 11/23 from the FULL six-report
//             set run 11/23 ~12:40 PM — Technician Schedule (11/01–11/30, the baseline),
//             Technician Production detail, Appointment List, Uncommitted Orders, Gain &
//             Loss (Tech-1 sorted; tech # = route #) and Call Back Report — through the
//             live ingest (ingestProductionReports, asOf 11/23). Jobs managers already
//             marked addressed are carried over on reload (lib/left-behind-carry.ts).
//   (prior) revision 4: month-to-date as of Fri 11/13 from three PestPac reports run
//             11/13 ~4:22 PM — Appointment List (11/01–11/30, still-open appointments),
//             Uncommitted Orders (11/01–11/13) and the Technician Production Report
//             (11/01–11/13, per-tech summary). Completed = committed production per route
//             owner (tech # = route #) + today's jobs done in the field but not yet
//             committed; LEFT BEHIND = anything dated before 11/13 still uncommitted or
//             open (flagged, like October); remaining = open appointments 11/13–11/30.
//             Same engine as the live upload (computeRouteProduction). Earlier revisions
//             (1–3) were the forward plan from the 10/30 Appointment List.
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
// A failed month is retried (at most once a minute per server instance) instead of
// being given up on until the next deploy, and the error is kept in the Setting
// `production_seed_error:<period>` so admins see it on Branch Command (COO 11/23:
// the Nov rev-5 reload never showed and the old code swallowed why).
let lastFailAt = 0;
const RETRY_MS = 60_000;
export const productionSeedErrorKey = (periodKey: string) => `production_seed_error:${periodKey}`;

export async function ensureProductionSeed(): Promise<void> {
  if (done) return;
  if (lastFailAt && Date.now() - lastFailAt < RETRY_MS) return;
  let failed = false;
  try {
    for (const seed of SEEDS) {
      try {
        const rev = String(seed.revision ?? 1);
        const markerKey = `production_seed_rev:${seed.periodKey}`;
        const marker = await prisma.setting.findUnique({ where: { key: markerKey } });
        if (marker?.value === rev) continue; // already at this revision — leave live data alone

        // Keep jobs managers already marked addressed (status + plan note) across the reload.
        const carry = await snapshotAddressed(seed.periodKey);
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
            data: applyAddressed(
              (seed.leftBehindJob as ProductionSeed[]).map((r) => ({
                ...r,
                scheduledDate: r.scheduledDate ? new Date(r.scheduledDate) : null,
              })),
              carry,
            ),
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
          prisma.setting.deleteMany({ where: { key: productionSeedErrorKey(seed.periodKey) } }),
        ]);
        console.log(`ensureProductionSeed: loaded ${seed.periodKey} rev ${rev}`);
      } catch (e) {
        // best-effort per month; a failure on one month must not block the others
        failed = true;
        const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 600);
        console.error(`ensureProductionSeed: ${seed.periodKey} rev ${String(seed.revision ?? 1)} failed:`, msg);
        await prisma.setting
          .upsert({
            where: { key: productionSeedErrorKey(seed.periodKey) },
            update: { value: JSON.stringify({ rev: seed.revision, at: new Date().toISOString(), error: msg }) },
            create: { key: productionSeedErrorKey(seed.periodKey), value: JSON.stringify({ rev: seed.revision, at: new Date().toISOString(), error: msg }) },
          })
          .catch(() => {});
      }
    }
    if (failed) lastFailAt = Date.now();
    else done = true;
  } catch {
    // best-effort; never block render
    lastFailAt = Date.now();
  }
}
