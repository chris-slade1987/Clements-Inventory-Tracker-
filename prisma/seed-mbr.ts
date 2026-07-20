import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Seeds a single month's Monthly Board Report (MBR) into the management tables
// from a committed JSON snapshot (prisma/data/mbr-YYYY-MM.json). Aggregate KPIs,
// line-of-business revenue, and per-technician PRODUCTION only — NO manager
// compensation is ever stored.
//
// This mirrors commitMbr() in lib/mbr/extract.ts, inlined so the deploy script
// has no "@/..." path-alias dependency. It is GUARDED: it only writes when the
// target ReportPeriod does not already exist, so a later in-app upload or manual
// correction is never clobbered on redeploy.
//
// Run standalone: npx tsx prisma/seed-mbr.ts

type ParsedKpi = { key: string; scope: string; basis: string; actual: number | null; budget: number | null };
type ParsedLob = { scope: string; lob: string; revenue: number };
type ParsedTech = { scope: string; name: string; lob: string | null; actual: number; budget: number };
type ParsedMbr = {
  year: number;
  month: number;
  label: string;
  kpis: ParsedKpi[];
  lob: ParsedLob[];
  techProduction: ParsedTech[];
  source: string;
};

// P&L line-item detail keys (SG&A drilldown + below-the-line other-expense).
// These are reconciled onto an already-loaded June even on the guarded path, so
// the newer P&L detail reaches a month that was seeded before this data existed.
// NO per-manager/individual comp — overhead comp is only the aggregate buckets.
const PNL_DETAIL_KEYS = new Set<string>([
  "depreciation", "amortization", "interest_expense", "management_fee",
  "back_office_total", "officer_total", "advertising", "bankcard_fees",
  "supplies_shop", "postage", "professional_fees", "software", "insurance_general",
  "non_tech_vehicle_insurance", "employer_401_contrib", "office_expense",
  "rent_property_tax", "repairs_maint_office", "rent_vacant_lot", "telephone",
  "utilities", "bank_charges", "contributions", "dues_subscriptions",
  "education_seminars", "equipment_rental", "entertainment_meals", "payroll_fees",
  "misc_sga", "travel", "uniforms", "other_cell_phones",
]);

export async function seedMbrJune(prisma: PrismaClient) {
  const file = join(__dirname, "data", "mbr-2026-06.json");
  const p = JSON.parse(readFileSync(file, "utf8")) as ParsedMbr;

  // Guard: don't clobber an existing period's KPIs/tech (a later manual
  // correction wins) — BUT always reconcile line-of-business revenue AND the
  // P&L line-item detail from the snapshot, so corrected LOB mappings and the
  // newer SG&A/other-expense drilldown propagate to an already-loaded month.
  const existing = await prisma.reportPeriod.findUnique({
    where: { year_month: { year: p.year, month: p.month } },
  });
  if (existing) {
    await prisma.lobRevenue.deleteMany({ where: { periodId: existing.id } });
    let lob = 0;
    for (const l of p.lob) {
      try {
        await prisma.lobRevenue.create({ data: { periodId: existing.id, scope: l.scope, lob: l.lob, revenue: l.revenue } });
        lob++;
      } catch {
        // ignore duplicate (periodId, scope, lob) collisions.
      }
    }
    // Reconcile only the P&L-detail KpiValue rows (leave other KPIs untouched).
    await prisma.kpiValue.deleteMany({ where: { periodId: existing.id, kpiKey: { in: [...PNL_DETAIL_KEYS] } } });
    let pnlDetail = 0;
    for (const k of p.kpis) {
      if (!PNL_DETAIL_KEYS.has(k.key)) continue;
      try {
        await prisma.kpiValue.create({
          data: { periodId: existing.id, kpiKey: k.key, scope: k.scope, basis: k.basis, actual: k.actual, budget: k.budget },
        });
        pnlDetail++;
      } catch {
        // ignore duplicate (periodId, kpiKey, scope, basis) collisions.
      }
    }
    return { skipped: true as const, reconciledLob: lob, reconciledPnlDetail: pnlDetail, periodId: existing.id, kpis: 0, techs: 0 };
  }

  const period = await prisma.reportPeriod.create({
    data: { year: p.year, month: p.month, label: p.label },
  });

  let kpis = 0;
  for (const k of p.kpis) {
    await prisma.kpiValue.create({
      data: { periodId: period.id, kpiKey: k.key, scope: k.scope, basis: k.basis, actual: k.actual, budget: k.budget },
    });
    kpis++;
  }
  let lob = 0;
  for (const l of p.lob) {
    try {
      await prisma.lobRevenue.create({ data: { periodId: period.id, scope: l.scope, lob: l.lob, revenue: l.revenue } });
      lob++;
    } catch {
      // ignore duplicate (periodId, scope, lob) collisions, matching commitMbr.
    }
  }
  let techs = 0;
  for (const t of p.techProduction) {
    await prisma.techProduction.create({
      data: { periodId: period.id, scope: t.scope, techName: t.name, lob: t.lob, actual: t.actual, budget: t.budget },
    });
    techs++;
  }

  return { skipped: false as const, periodId: period.id, kpis, lob, techs };
}

// Allow running directly (npx tsx prisma/seed-mbr.ts).
if (require.main === module) {
  const prisma = new PrismaClient();
  seedMbrJune(prisma)
    .then((r) => console.log("seed-mbr:", JSON.stringify(r)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
