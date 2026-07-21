import { PrismaClient } from "@prisma/client";

// Test fixture: back-date the weekly checklist template's go-live so that
// several fully-elapsed ISO weeks exist before "now". The app's lazy
// sweepMissedChecklists() (run on My Branch / Alerts / Oversight page loads)
// will then create open ChecklistMiss rows end-to-end — exercising real
// detection rather than hand-inserted rows. Idempotent + deterministic.
const p = new PrismaClient();

(async () => {
  const goLive = new Date(Date.now() - 56 * 864e5); // ~8 weeks ago
  const res = await p.checklistTemplate.updateMany({
    where: { key: "weekly" },
    data: { createdAt: goLive },
  });
  // Start from a clean slate so the sweep re-derives misses freshly each run.
  const del = await p.checklistMiss.deleteMany({});
  console.log(
    `setup-misses: backdated weekly go-live to ${goLive.toISOString().slice(0, 10)} (${res.count} template); cleared ${del.count} prior miss rows.`
  );
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
