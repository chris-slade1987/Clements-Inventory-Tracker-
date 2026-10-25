import "server-only";
import { prisma } from "@/lib/prisma";
import { parseRoutingReport, branchFromTechNumber } from "@/lib/routing-parse";
import {
  detectReportType, parseProductionReport, parseAppointmentList, parseUnservicedReport,
  parseGainLossReport, parseCallbackReport, type ReportType,
} from "@/lib/branch-production-parse";
import { computeRouteProduction, type SchedStop, type ProductionInput } from "@/lib/branch-production";

// Branch Command — monthly production ingest. Takes the multi-file drop (6 PestPac
// reports), auto-detects + parses each, runs the pacing/completion engine against the
// schedule baseline, and persists the durable per-route warehouse (RouteMonth) + the
// left-behind jobs (for drill-down + the forced weekly gameplan). Re-upload replaces the
// period. All matching is by PestPac account #. See docs/BRANCH-COMMAND-REPORTS.md.

export type UploadFile = { fileName: string; text: string };
const isoDate = (s: string) => (s || "").trim().slice(0, 10).replace(/\//g, "-");
function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/** Parse-only preview: what each file is, the period, and the counts — for confirm-before-apply. */
export function previewProductionReports(files: UploadFile[]): {
  ok: boolean; error?: string; periodKey?: string; detected?: { fileName: string; type: ReportType; rows: number }[]; missing?: ReportType[];
} {
  const detected: { fileName: string; type: ReportType; rows: number }[] = [];
  let periodKey: string | undefined;
  for (const f of files) {
    const type = detectReportType(f.text);
    let rows = 0;
    if (type === "schedule") { const p = parseRoutingReport(f.text); rows = p.totalStops; if (p.periodStart) { const [y, m] = p.periodStart.split("/"); periodKey = `${y}-${m}`; } }
    else if (type === "production") rows = parseProductionReport(f.text).length;
    else if (type === "appointments") rows = parseAppointmentList(f.text).length;
    else if (type === "unserviced") rows = parseUnservicedReport(f.text).length;
    else if (type === "gainloss") rows = parseGainLossReport(f.text).length;
    else if (type === "callback") rows = parseCallbackReport(f.text).length;
    detected.push({ fileName: f.fileName, type, rows });
  }
  if (!detected.some((d) => d.type === "schedule")) return { ok: false, error: "The monthly Technician Schedule Report is required — it's the baseline plan.", detected };
  const have = new Set(detected.map((d) => d.type));
  const missing = (["production", "appointments", "unserviced", "gainloss", "callback"] as ReportType[]).filter((t) => !have.has(t));
  return { ok: true, periodKey, detected, missing };
}

export async function ingestProductionReports(opts: { files: UploadFile[]; uploadedById?: string | null; uploadedByName?: string | null; asOfDate?: string }): Promise<{ ok: boolean; error?: string; periodKey?: string; routes?: number; leftBehind?: number }> {
  const byType = new Map<ReportType, UploadFile>();
  for (const f of opts.files) { const t = detectReportType(f.text); if (t !== "unknown") byType.set(t, f); }

  const schedFile = byType.get("schedule");
  if (!schedFile) return { ok: false, error: "The monthly Technician Schedule Report is required (the baseline)." };
  const sched = parseRoutingReport(schedFile.text);
  if (!sched.periodStart) return { ok: false, error: "Could not read the schedule's period." };
  const [py, pm] = sched.periodStart.split("/").map(Number);
  const periodKey = `${py}-${String(pm).padStart(2, "0")}`;
  const monthEnd = new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10);
  const today = etToday();
  const asOf = opts.asOfDate ?? (today < monthEnd ? today : monthEnd);

  // Baseline schedule + account→customer lookup.
  const scheduled: SchedStop[] = [];
  const customerByAccount = new Map<string, string>();
  const serviceByAccount = new Map<string, string>();
  for (const t of sched.techs) for (const s of t.stops) if (s.account) {
    scheduled.push({ account: s.account, route: t.techNumber, techName: t.techName, date: isoDate(s.date), dollars: s.amount || 0 });
    if (s.customer) customerByAccount.set(s.account, s.customer);
    if (s.service) serviceByAccount.set(s.account, s.service);
  }

  const completed = byType.has("production") ? parseProductionReport(byType.get("production")!.text).map((r) => ({ account: r.account, date: r.date, dollars: r.dollars })) : [];
  const appts = byType.has("appointments") ? parseAppointmentList(byType.get("appointments")!.text) : [];
  const rescheduledAccounts = [...new Set(appts.map((a) => a.account))];

  const unsRows = byType.has("unserviced") ? parseUnservicedReport(byType.get("unserviced")!.text) : [];
  const unsByAccount = new Map<string, { service: string; dollars: number; name: string }>();
  for (const u of unsRows) { unsByAccount.set(u.account, { service: u.service, dollars: u.dollars, name: u.name }); if (u.name && !customerByAccount.has(u.account)) customerByAccount.set(u.account, u.name); }
  const underservicedPastDue = unsRows.filter((u) => u.date < asOf).map((u) => ({ account: u.account, route: u.route, date: u.date, dollars: u.dollars }));

  const gl = byType.has("gainloss") ? parseGainLossReport(byType.get("gainloss")!.text) : [];
  const newStarts = gl.filter((g) => g.gainsCount > 0).map((g) => ({ account: g.account, route: g.route, dollars: g.gainsValue }));
  const cancellations = gl.filter((g) => g.lossCount > 0).map((g) => ({ account: g.account, route: g.route, dollars: g.lossValue }));

  const cb = byType.has("callback") ? parseCallbackReport(byType.get("callback")!.text) : [];
  const callbacksByRoute = new Map<string, number>();
  for (const c of cb) callbacksByRoute.set(c.route, (callbacksByRoute.get(c.route) || 0) + 1);

  const input: ProductionInput = { today: asOf, scheduled, completed, cancellations, newStarts, underservicedPastDue, rescheduledAccounts };
  const routes = computeRouteProduction(input);

  // Persist — replace the whole period (re-upload replaces).
  await prisma.$transaction([
    prisma.routeMonth.deleteMany({ where: { periodKey } }),
    prisma.leftBehindJob.deleteMany({ where: { periodKey } }),
    prisma.productionReportUpload.deleteMany({ where: { periodKey } }),
  ]);

  const routeRows: import("@prisma/client").Prisma.RouteMonthCreateManyInput[] = [];
  const lbRows: import("@prisma/client").Prisma.LeftBehindJobCreateManyInput[] = [];
  for (const r of routes) {
    const branch = branchFromTechNumber(r.route);
    routeRows.push({
      branch, periodKey, route: r.route, techName: r.techName,
      scheduledCount: r.scheduledCount, scheduledDollars: r.scheduledDollars,
      completedCount: r.completedCount, completedDollars: r.completedDollars,
      completionPct: r.completionPct, expectedPct: r.expectedPct, paceDeltaPct: r.paceDeltaPct, status: r.status,
      remainingCount: r.remainingCount, leftBehindCount: r.leftBehindCount, leftBehindDollars: Math.round(r.leftBehind.reduce((a, x) => a + (unsByAccount.get(x.account)?.dollars ?? 0), 0) * 100) / 100,
      rescheduledCount: scheduled.filter((s) => s.route === r.route && s.date < asOf && rescheduledAccounts.includes(s.account)).length,
      projectedPct: r.projectedCompletionPct,
      callbacks: callbacksByRoute.get(r.route) || 0,
      cancellations: r.cancellations, cancellationDollars: r.cancellationDollars,
      newStarts: r.newStarts, newStartDollars: r.newStartDollars,
      netRouteChange: r.netRouteChange, netRouteChangeDollars: r.netRouteChangeDollars,
    });
    for (const lb of r.leftBehind) {
      const info = unsByAccount.get(lb.account);
      lbRows.push({
        branch, periodKey, route: r.route, account: lb.account,
        customer: customerByAccount.get(lb.account) ?? null,
        service: info?.service ?? serviceByAccount.get(lb.account) ?? null,
        scheduledDate: lb.date ? new Date(lb.date + "T00:00:00Z") : null,
        dollars: info?.dollars ?? 0,
        source: info ? "unserviced" : "schedule_diff",
      });
    }
  }
  for (let i = 0; i < routeRows.length; i += 500) await prisma.routeMonth.createMany({ data: routeRows.slice(i, i + 500) });
  for (let i = 0; i < lbRows.length; i += 500) await prisma.leftBehindJob.createMany({ data: lbRows.slice(i, i + 500) });

  for (const [type, f] of byType) {
    await prisma.productionReportUpload.create({
      data: { periodKey, reportType: type, fileName: f.fileName, rowCount: byTypeRowCount(type, f), uploadedById: opts.uploadedById ?? null, uploadedByName: opts.uploadedByName ?? null },
    }).catch(() => {});
  }

  return { ok: true, periodKey, routes: routeRows.length, leftBehind: lbRows.length };
}

function byTypeRowCount(type: ReportType, f: UploadFile): number {
  try {
    if (type === "schedule") return parseRoutingReport(f.text).totalStops;
    if (type === "production") return parseProductionReport(f.text).length;
    if (type === "appointments") return parseAppointmentList(f.text).length;
    if (type === "unserviced") return parseUnservicedReport(f.text).length;
    if (type === "gainloss") return parseGainLossReport(f.text).length;
    if (type === "callback") return parseCallbackReport(f.text).length;
  } catch { /* ignore */ }
  return 0;
}

export type RouteMonthView = Awaited<ReturnType<typeof getBranchProductionMonth>>;

/** Read a branch's computed production month + totals + left-behind for the UI. */
export async function getBranchProductionMonth(branch: string, periodKey: string) {
  const [routes, uploads] = await Promise.all([
    prisma.routeMonth.findMany({ where: { branch, periodKey }, orderBy: [{ leftBehindCount: "desc" }, { route: "asc" }] }).catch(() => []),
    prisma.productionReportUpload.findMany({ where: { periodKey }, orderBy: { uploadedAt: "desc" } }).catch(() => []),
  ]);
  const totals = routes.reduce(
    (a, r) => ({
      scheduled: a.scheduled + r.scheduledCount, completed: a.completed + r.completedCount,
      leftBehind: a.leftBehind + r.leftBehindCount, leftBehindDollars: a.leftBehindDollars + r.leftBehindDollars,
      remaining: a.remaining + r.remainingCount, callbacks: a.callbacks + r.callbacks,
      netChange: a.netChange + r.netRouteChange, netChangeDollars: a.netChangeDollars + r.netRouteChangeDollars,
    }),
    { scheduled: 0, completed: 0, leftBehind: 0, leftBehindDollars: 0, remaining: 0, callbacks: 0, netChange: 0, netChangeDollars: 0 }
  );
  return {
    periodKey,
    routes,
    uploads: uploads.map((u) => ({ type: u.reportType, fileName: u.fileName, rows: u.rowCount, uploadedAt: u.uploadedAt.toISOString(), uploadedBy: u.uploadedByName })),
    totals: { ...totals, completionPct: totals.scheduled ? Math.round((1000 * totals.completed) / totals.scheduled) / 10 : 0 },
  };
}

/** Periods (newest first) that have production loaded for a branch. */
export async function listProductionPeriods(branch: string): Promise<string[]> {
  const rows = await prisma.routeMonth.findMany({ where: { branch }, distinct: ["periodKey"], select: { periodKey: true }, orderBy: { periodKey: "desc" } }).catch(() => []);
  return rows.map((r) => r.periodKey);
}

/** Cross-branch production rollup (latest loaded month per branch) — for leadership. */
export async function getProductionRollup(branches: string[]): Promise<{ branch: string; periodKey: string | null; completionPct: number; leftBehind: number; leftBehindDollars: number; remaining: number; callbacks: number; netChangeDollars: number; routes: number }[]> {
  const out = [];
  for (const branch of branches) {
    const periods = await listProductionPeriods(branch);
    const pk = periods[0] ?? null;
    if (!pk) { out.push({ branch, periodKey: null, completionPct: 0, leftBehind: 0, leftBehindDollars: 0, remaining: 0, callbacks: 0, netChangeDollars: 0, routes: 0 }); continue; }
    const m = await getBranchProductionMonth(branch, pk);
    out.push({ branch, periodKey: pk, completionPct: m.totals.completionPct, leftBehind: m.totals.leftBehind, leftBehindDollars: m.totals.leftBehindDollars, remaining: m.totals.remaining, callbacks: m.totals.callbacks, netChangeDollars: m.totals.netChangeDollars, routes: m.routes.length });
  }
  return out;
}

/** Left-behind jobs for a branch/period (optionally one route) — the drill-down + gameplan list. */
export async function getLeftBehindJobs(branch: string, periodKey: string, route?: string) {
  const rows = await prisma.leftBehindJob.findMany({ where: { branch, periodKey, ...(route ? { route } : {}) }, orderBy: [{ dollars: "desc" }, { scheduledDate: "asc" }] }).catch(() => []);
  return rows.map((r) => ({ id: r.id, route: r.route, account: r.account, customer: r.customer, service: r.service, scheduledDate: r.scheduledDate ? r.scheduledDate.toISOString().slice(0, 10) : null, dollars: r.dollars, status: r.status, managerNote: r.managerNote }));
}
