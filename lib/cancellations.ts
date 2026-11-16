import "server-only";
import { prisma } from "@/lib/prisma";
import techData from "@/prisma/data/tech-numbers.json";
import nov2026 from "@/prisma/data/cancellations/2026-11.json";
import { branchKpiMonthly } from "@/lib/branch-kpis";
import { BRANCHES } from "@/lib/management";
import { totalsMatch, type ParsedCancellations, type CancellationRow } from "@/lib/cancellations-parse";

// ---------------------------------------------------------------------------
// Cancellation Center — storage + reads.
//
// Source: the PestPac Gain & Loss Report for one month, sorted by Branch, Route
// (parsed by lib/cancellations-parse.ts). One ACTIVE upload per month; a newer
// upload for the same month replaces it (old rows removed, the upload log row is
// kept with active=false). These are imported report rows, not stock movements.
// November 2026 (11/1–11/16, the COO's 11/16 run) ships as committed JSON and is
// loaded at runtime by ensureCancellationsSeeded() — production only accepts
// runtime writes.
// ---------------------------------------------------------------------------

export type CancellationRecordRow = CancellationRow & { techName: string | null };

const norm = (s: string) => s.replace(/^0+(?=\d)/, "").trim();

/** Route number → route holder's name, per branch. Active employee profiles first,
 *  then the COO's phone list. Keyed "branch|route". */
export async function techNamesByRoute(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  type Phone = { name: string; techNumber: string | null; branch: string };
  for (const p of (techData as { people: Phone[] }).people) {
    if (p.techNumber) m.set(`${p.branch}|${norm(p.techNumber)}`, p.name);
  }
  const emps = await prisma.employee.findMany({
    where: { status: "active", routeNumber: { not: null } },
    select: { name: true, routeNumber: true, branch: true },
  });
  for (const e of emps) {
    if (e.routeNumber && e.branch) m.set(`${e.branch}|${norm(e.routeNumber)}`, e.name);
  }
  return m;
}

/** Save a parsed month, replacing any earlier upload for the same month. */
export async function importCancellations(opts: {
  parsed: ParsedCancellations;
  fileName: string;
  source: "upload" | "seed";
  uploadedBy: string | null;
}): Promise<{ uploadId: string; rows: number; replaced: number }> {
  const { parsed } = opts;
  const names = await techNamesByRoute();
  const lossCount = parsed.rows.reduce((s, r) => s + r.lossCount, 0);
  const lossValue = Math.round(parsed.rows.reduce((s, r) => s + r.lossValue, 0) * 100) / 100;

  return prisma.$transaction(async (tx) => {
    const prior = await tx.cancellationUpload.findMany({ where: { periodKey: parsed.periodKey, active: true }, select: { id: true } });
    if (prior.length) {
      await tx.cancellationRecord.deleteMany({ where: { uploadId: { in: prior.map((p) => p.id) } } });
      await tx.cancellationUpload.updateMany({ where: { id: { in: prior.map((p) => p.id) } }, data: { active: false } });
    }
    const up = await tx.cancellationUpload.create({
      data: {
        periodKey: parsed.periodKey,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        fileName: opts.fileName,
        rowCount: parsed.rows.length,
        lossCount,
        lossValue,
        source: opts.source,
        uploadedBy: opts.uploadedBy,
      },
    });
    if (parsed.rows.length) {
      await tx.cancellationRecord.createMany({
        data: parsed.rows.map((r) => ({
          uploadId: up.id,
          periodKey: parsed.periodKey,
          branch: r.branch,
          route: r.route,
          techName: names.get(`${r.branch}|${norm(r.route)}`) ?? null,
          account: r.account,
          customer: r.customer,
          address: r.address,
          city: r.city,
          zip: r.zip,
          serviceCode: r.serviceCode,
          division: r.division,
          lossCount: r.lossCount,
          lossValue: r.lossValue,
        })),
      });
    }
    return { uploadId: up.id, rows: parsed.rows.length, replaced: prior.length };
  });
}

// --- November 2026 seed (runtime, once) ------------------------------------
const SEED_MARKER = "cancellations_seed_2026_11_v1";
let seeding: Promise<void> | null = null;

export function ensureCancellationsSeeded(): Promise<void> {
  if (!seeding) {
    seeding = (async () => {
      try {
        const done = await prisma.setting.findUnique({ where: { key: SEED_MARKER } });
        if (done) return;
        const parsed = nov2026 as unknown as ParsedCancellations & { fileName: string };
        // A real upload for the month always wins over the seed.
        const existing = await prisma.cancellationUpload.count({ where: { periodKey: parsed.periodKey, active: true } });
        if (!existing && totalsMatch(parsed) !== false) {
          await importCancellations({ parsed, fileName: parsed.fileName, source: "seed", uploadedBy: "Chris Slade (11/16 report)" });
        }
        await prisma.setting.upsert({
          where: { key: SEED_MARKER },
          create: { key: SEED_MARKER, value: new Date().toISOString() },
          update: { value: new Date().toISOString() },
        });
      } catch (e) {
        console.error("ensureCancellationsSeeded:", e);
        seeding = null; // retry on the next request
      }
    })();
  }
  return seeding;
}

// --- Reads ------------------------------------------------------------------
export type CancellationMonth = { periodKey: string; startDate: string; endDate: string; fileName: string; uploadedBy: string | null; createdAt: Date; rowCount: number };

export async function listCancellationMonths(): Promise<CancellationMonth[]> {
  const ups = await prisma.cancellationUpload.findMany({
    where: { active: true },
    orderBy: { periodKey: "desc" },
    select: { periodKey: true, startDate: true, endDate: true, fileName: true, uploadedBy: true, createdAt: true, rowCount: true },
  });
  return ups;
}

export async function loadCancellations(periodKeys: string[], branch: string | null): Promise<(CancellationRecordRow & { periodKey: string })[]> {
  const rows = await prisma.cancellationRecord.findMany({
    where: { periodKey: { in: periodKeys }, ...(branch ? { branch } : {}), upload: { active: true } },
    orderBy: [{ lossValue: "desc" }],
  });
  return rows.map((r) => ({
    periodKey: r.periodKey,
    branch: r.branch,
    route: r.route,
    techName: r.techName,
    account: r.account,
    customer: r.customer,
    address: r.address,
    city: r.city,
    zip: r.zip,
    serviceCode: r.serviceCode,
    division: r.division as CancellationRow["division"],
    lossCount: r.lossCount,
    lossValue: r.lossValue,
  }));
}

/** MBR "attrition" (cancellations $) month actuals for a YYYY-MM, by scope. Empty
 *  when no Monthly Board Report has been uploaded for that month. */
export async function mbrAttritionFor(periodKey: string): Promise<Map<string, number>> {
  const [y, m] = periodKey.split("-").map(Number);
  const period = await prisma.reportPeriod.findUnique({ where: { year_month: { year: y, month: m } }, select: { id: true } });
  const out = new Map<string, number>();
  if (!period) return out;
  const vals = await prisma.kpiValue.findMany({ where: { periodId: period.id, kpiKey: "attrition", basis: "month" }, select: { scope: true, actual: true } });
  for (const v of vals) if (v.actual != null) out.set(v.scope, v.actual);
  return out;
}

// --- Budget vs actual ---------------------------------------------------------
// Budget = the 2026 Branch KPI workbook's monthly "cancellations" targets
// (BranchKpiTarget) — the same targets the quarterly branch scorecards grade on
// (lib/branch-kpis.ts). Actuals per month: the official MBR cancellations
// ("attrition", else the workbook's own Q1 actual) when present, otherwise this
// Cancellation Center's upload for that month (month-to-date while it's open).
// Lower is better for cancellations.

export type BudgetMonth = { m: number; label: string; budget: number | null; actual: number | null; source: "mbr" | "upload" | null; throughDay: number | null };

export async function cancellationBudgetYear(scope: string, year: number): Promise<BudgetMonth[]> {
  const [points, ups] = await Promise.all([
    branchKpiMonthly(scope, year, "cancellations"),
    prisma.cancellationUpload.findMany({ where: { active: true, periodKey: { startsWith: `${year}-` } }, select: { id: true, periodKey: true, endDate: true } }),
  ]);
  const uploadTotals = new Map<number, { value: number; endDate: string }>();
  for (const u of ups) {
    const agg = await prisma.cancellationRecord.aggregate({
      where: { uploadId: u.id, ...(scope === "company" ? {} : { branch: scope }) },
      _sum: { lossValue: true },
    });
    uploadTotals.set(Number(u.periodKey.slice(5, 7)), { value: agg._sum.lossValue ?? 0, endDate: u.endDate });
  }
  return points.map((p) => {
    const up = uploadTotals.get(p.m);
    if (p.actual != null) return { m: p.m, label: p.label, budget: p.target, actual: p.actual, source: "mbr" as const, throughDay: null };
    if (up) return { m: p.m, label: p.label, budget: p.target, actual: Math.round(up.value * 100) / 100, source: "upload" as const, throughDay: Number(up.endDate.slice(8, 10)) };
    return { m: p.m, label: p.label, budget: p.target, actual: null, source: null, throughDay: null };
  });
}

/** Each branch's budget for one month (YYYY-MM). */
export async function cancellationBudgetByBranch(periodKey: string): Promise<Map<string, number>> {
  const [y, m] = periodKey.split("-").map(Number);
  const rows = await prisma.branchKpiTarget.findMany({ where: { year: y, month: m, kpiKey: "cancellations", branch: { in: BRANCHES.map((b) => b.key) } }, select: { branch: true, target: true } });
  const out = new Map<string, number>();
  for (const r of rows) if (r.target != null) out.set(r.branch, r.target);
  return out;
}
