import "server-only";
import { prisma } from "@/lib/prisma";
import mbr06 from "@/prisma/data/mbr-2026-06.json";
import mbr07 from "@/prisma/data/mbr-2026-07.json";
import mbr08 from "@/prisma/data/mbr-2026-08.json";
import mbr09 from "@/prisma/data/mbr-2026-09.json";

// Runtime Monthly Board Report (MBR) loader + REPAIR.
//
// Why this exists: the build-time deploy-db seed doesn't reliably land in the LIVE
// production database (the Vercel build DB is not the runtime DB — the same reason
// the org chart and catalog needed runtime heal). So a committed month's financials
// can be in the repo yet missing (or PARTIALLY present) in prod.
//
// This is called from the shared authenticated layout, so every data surface — the
// exec/board dashboards AND the Branch KPIs / scorecards, including for branch-locked
// managers who can't reach exec/board — gets the latest month loaded.
//
// It doesn't just create a missing period; it RECONCILES each committed month so a
// period that exists but is missing rows (e.g. the branch-scoped KpiValue rows the
// Branch KPIs read — the exact gap that showed September on the P&L but blank on the
// branch board) gets its missing rows backfilled. It only ADDS rows (createMany
// skipDuplicates on the unique keys), so a later manual correction is never clobbered.
// Idempotent + non-fatal, with a cheap fast-path once the newest month is complete.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParsedMbr = any;
const MONTHS = [mbr06, mbr07, mbr08, mbr09] as ParsedMbr[];
const BRANCH_SCOPES = ["vero", "stuart", "orlando", "naples"];

let _ran = false;

export async function ensureMbrLoaded(): Promise<void> {
  if (_ran) return;
  try {
    // Fast-path: newest committed month exists AND already carries its branch-scoped
    // month rows → the data surfaces are healthy, nothing to do.
    const newest = MONTHS[MONTHS.length - 1];
    const newestPeriod = await prisma.reportPeriod.findUnique({
      where: { year_month: { year: newest.year, month: newest.month } },
      select: { id: true },
    });
    if (newestPeriod) {
      const hasBranchRows = await prisma.kpiValue.findFirst({
        where: { periodId: newestPeriod.id, basis: "month", scope: { in: BRANCH_SCOPES } },
        select: { id: true },
      });
      if (hasBranchRows) {
        _ran = true;
        return;
      }
    }

    // Reconcile every committed month (repairs missing/partial periods).
    const kpiKeys = new Set(
      (await prisma.kpi.findMany({ select: { key: true } })).map((k) => k.key),
    );
    for (const p of MONTHS) {
      try {
        await reconcileMonth(p, kpiKeys);
      } catch (e) {
        console.error(`ensureMbrLoaded: failed to reconcile ${p?.label ?? "a month"}:`, e);
      }
    }
    _ran = true;
  } catch (e) {
    console.error("ensureMbrLoaded failed (non-fatal):", e);
  }
}

async function reconcileMonth(p: ParsedMbr, kpiKeys: Set<string>): Promise<void> {
  // Ensure the period exists.
  let period = await prisma.reportPeriod.findUnique({
    where: { year_month: { year: p.year, month: p.month } },
    select: { id: true },
  });
  if (!period) {
    period = await prisma.reportPeriod.create({
      data: { year: p.year, month: p.month, label: p.label },
      select: { id: true },
    });
  }
  const periodId = period.id;

  // Backfill any missing KpiValue rows — ADD-only (never touch an existing/manually
  // corrected row). We find what's already there and insert only the gaps, so this is
  // provider-agnostic (SQLite locally / Postgres in prod) and fully idempotent.
  // FK-filter to known Kpi keys so one stray key can't fail the batch.
  const existingKv = await prisma.kpiValue.findMany({
    where: { periodId },
    select: { kpiKey: true, scope: true, basis: true },
  });
  const haveKv = new Set(existingKv.map((r) => `${r.kpiKey}|${r.scope}|${r.basis}`));
  const kvData = (p.kpis as ParsedMbr[])
    .filter((k) => kpiKeys.has(k.key) && !haveKv.has(`${k.key}|${k.scope}|${k.basis}`))
    .map((k) => ({
      periodId,
      kpiKey: k.key,
      scope: k.scope,
      basis: k.basis,
      actual: k.actual ?? null,
      budget: k.budget ?? null,
    }));
  if (kvData.length) {
    await prisma.kpiValue.createMany({ data: kvData });
  }

  // Line-of-business revenue — ADD-only (unique [periodId,scope,lob]).
  const existingLob = await prisma.lobRevenue.findMany({
    where: { periodId },
    select: { scope: true, lob: true },
  });
  const haveLob = new Set(existingLob.map((r) => `${r.scope}|${r.lob}`));
  const lobData = (p.lob as ParsedMbr[])
    .filter((l) => !haveLob.has(`${l.scope}|${l.lob}`))
    .map((l) => ({ periodId, scope: l.scope, lob: l.lob, revenue: l.revenue }));
  if (lobData.length) {
    await prisma.lobRevenue.createMany({ data: lobData });
  }

  // Technician production has no unique key, so only seed it when the period has none
  // (avoids duplicating rows on a re-run).
  const techCount = await prisma.techProduction.count({ where: { periodId } });
  if (techCount === 0 && (p.techProduction as ParsedMbr[]).length) {
    await prisma.techProduction.createMany({
      data: (p.techProduction as ParsedMbr[]).map((t) => ({
        periodId,
        scope: t.scope,
        techName: t.name,
        lob: t.lob ?? null,
        actual: t.actual,
        budget: t.budget,
      })),
    });
  }
}
