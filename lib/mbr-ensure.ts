import "server-only";
import { prisma } from "@/lib/prisma";
import { seedMbrParsed } from "@/prisma/seed-mbr";
import mbr06 from "@/prisma/data/mbr-2026-06.json";
import mbr07 from "@/prisma/data/mbr-2026-07.json";
import mbr08 from "@/prisma/data/mbr-2026-08.json";
import mbr09 from "@/prisma/data/mbr-2026-09.json";

// Runtime Monthly Board Report (MBR) loader.
//
// Why this exists: the build-time deploy-db seed does NOT reliably land in the LIVE
// production database (the Vercel build DB is not the runtime DB — the same reason
// the org chart and catalog needed runtime auto-heal). So a committed month's
// financials (e.g. September 2026) can be in the repo + deploy-db yet never appear
// on the dashboards, which read the latest ReportPeriod. This loads any committed
// month whose ReportPeriod is MISSING, at runtime, from the statically-imported JSON
// (bundled into the function — unlike a readFileSync of a repo path).
//
// Idempotent + guarded: seedMbrParsed only creates a period that doesn't exist and
// otherwise just reconciles LOB + P&L detail, so a later in-app correction is never
// clobbered. Non-fatal — a failure here never breaks the dashboard render.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MONTHS = [mbr06, mbr07, mbr08, mbr09] as any[];

let _ran = false;

export async function ensureMbrLoaded(): Promise<void> {
  if (_ran) return; // once per warm server instance is plenty
  try {
    // Cheap fast-path: if the newest committed month already exists, nothing to do.
    const newest = MONTHS[MONTHS.length - 1];
    const present = await prisma.reportPeriod.findUnique({
      where: { year_month: { year: newest.year, month: newest.month } },
      select: { id: true },
    });
    if (present) {
      _ran = true;
      return;
    }
    for (const p of MONTHS) {
      try {
        await seedMbrParsed(prisma, p);
      } catch (e) {
        console.error(`ensureMbrLoaded: failed to load ${p?.label ?? "a month"}:`, e);
      }
    }
    _ran = true;
  } catch (e) {
    console.error("ensureMbrLoaded failed (non-fatal):", e);
  }
}
