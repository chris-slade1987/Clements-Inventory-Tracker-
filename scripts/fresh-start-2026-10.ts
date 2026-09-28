/**
 * Oct 1, 2026 "full fresh start" — one-time production cleanup for the
 * manager / director launch.
 *
 * WHAT IT DOES
 *   Clears the OPERATIONAL / test data that accumulated while the portal was
 *   being built and tested, so branch managers and directors log in to a clean
 *   board on day one (no stale inspections, checklist runs, open reminders,
 *   test PTO, demo candidates, sample threads, etc.). Then it provisions the
 *   real branch-manager logins and deactivates the fictional placeholder
 *   managers seeded on the very first deploy.
 *
 * WHAT IT KEEPS (never touched)
 *   - Inventory: products, invoices/lines, and ALL stock movements (current
 *     on-hand — includes the real 7/27/2026 physical count) and the technician
 *     dispersement roster.
 *   - People: every Employee profile + every login (User). Separations kept.
 *   - Financials: ReportPeriod / Kpi / KpiValue / BranchKpiTarget / LobRevenue /
 *     TechProduction / ScorecardResult (MBR + KPI history).
 *   - Fleet reference: vehicles, vehicle documents, service history, fuel.
 *   - Insurance policies + installments + documents.
 *   - Branch Hub documents + contacts.
 *   - Templates & catalogs: checklist templates, hiring templates + question
 *     bank, courses, and CURRENT training assignments.
 *   - Real job postings (only [DEMO]-titled jobs are removed).
 *   - Company bulletin posts + acks, calendar events (holidays).
 *   - Handbook / manual policy documents + acknowledgments.
 *
 * SAFETY
 *   - Runs ONLY when env `FRESH_START_2026_10=1` (operator opt-in in Vercel,
 *     removed after). Inert on every other deploy.
 *   - Applies EXACTLY ONCE — guarded by the `fresh_start_2026_10_applied`
 *     Setting marker, so leaving the flag on can never re-wipe.
 *   - No hard requirement: wired NON-FATAL into deploy-db.
 */
import type { PrismaClient } from "@prisma/client";

const MARKER_KEY = "fresh_start_2026_10_applied";

// Branch key -> warehouse name (mirrors lib/constants STANDARD_WAREHOUSES).
const BRANCH_WAREHOUSE: Record<string, string> = {
  vero: "Vero Beach (HQ)",
  stuart: "Stuart",
  orlando: "Orlando",
  naples: "Naples",
};

// Fictional placeholder branch-manager logins seeded on the first deploy
// (prisma/seed-core.ts). Deactivated in favor of the real managers below.
const PLACEHOLDER_MANAGER_EMAILS = [
  "vero@clementspestcontrol.com",
  "stuart@clementspestcontrol.com",
  "orlando@clementspestcontrol.com",
  "naples@clementspestcontrol.com",
];

// The real branch managers. Their logins already exist (from the roster / people
// seed); this re-asserts active + manager access + branch pin so each lands on
// their own branch on first login. Passwords are NOT changed here — set/reset
// them in Users & Access (/manage/managers) and share the temp with each manager.
const REAL_MANAGERS: Array<{ email: string; branch: string }> = [
  { email: "jcolontrelle@clementspestcontrol.com", branch: "vero" },
  { email: "agoetz@clementspestcontrol.com", branch: "stuart" },
  { email: "etravelute@clementspestcontrol.com", branch: "orlando" },
  { email: "ccarter@clementspestcontrol.com", branch: "naples" },
];

export async function freshStart2026(prisma: PrismaClient) {
  if (process.env.FRESH_START_2026_10 !== "1") {
    return { ran: false, reason: "FRESH_START_2026_10 not set" };
  }
  const already = await prisma.setting.findUnique({ where: { key: MARKER_KEY } });
  if (already) {
    return { ran: false, reason: "already applied", appliedAt: already.value };
  }

  const cleared: Record<string, number> = {};
  const clear = async (label: string, fn: () => Promise<{ count: number }>) => {
    const r = await fn();
    cleared[label] = r.count;
  };

  // --- Applicant tracking (all test candidates) --------------------------
  // Interview cascades from Candidate; PreHireDocument cascades from PreHire.
  await clear("interviews", () => prisma.interview.deleteMany({}));
  await clear("candidates", () => prisma.candidate.deleteMany({}));
  await clear("preHires", () => prisma.preHire.deleteMany({}));
  await clear("demoJobs", () => prisma.job.deleteMany({ where: { title: { contains: "[DEMO]" } } }));

  // --- Personnel records + new-hire reviews (test) -----------------------
  // PersonnelSignature + SignatureRequest cascade from PersonnelRecord.
  await clear("signatureRequests", () => prisma.signatureRequest.deleteMany({}));
  await clear("personnelRecords", () => prisma.personnelRecord.deleteMany({}));
  await clear("newHireReviews", () => prisma.newHireReview.deleteMany({}));

  // --- Manager scorecard review DRAFTS (ScorecardResult history kept) -----
  // ScorecardSignature cascades from ScorecardReview.
  await clear("scorecardReviews", () => prisma.scorecardReview.deleteMany({}));

  // --- Branch audits + prechecks (rideAlongs/followUps cascade) ----------
  await clear("branchAudits", () => prisma.branchAudit.deleteMany({}));
  await clear("auditPrechecks", () => prisma.auditPrecheck.deleteMany({}));

  // --- Inspections & checklists (the named "start fresh" items) -----------
  await clear("warehouseInspections", () => prisma.warehouseInspection.deleteMany({}));
  await clear("qcInspections", () => prisma.qcInspection.deleteMany({}));
  await clear("vehicleInspections", () => prisma.vehicleInspection.deleteMany({}));
  await clear("checklistMisses", () => prisma.checklistMiss.deleteMany({}));
  await clear("checklistCompletions", () => prisma.checklistCompletion.deleteMany({}));

  // --- Open task noise: alerts + reminders -------------------------------
  await clear("alerts", () => prisma.alert.deleteMany({}));
  await clear("reminders", () => prisma.reminder.deleteMany({}));

  // --- HR/leave test data ------------------------------------------------
  await clear("ptoRequests", () => prisma.ptoRequest.deleteMany({}));
  await clear("absences", () => prisma.absence.deleteMany({}));

  // --- Sales test data (example goal sheets + sync snapshots) ------------
  await clear("salesGoalSheets", () => prisma.salesGoalSheet.deleteMany({}));
  await clear("salesSnapshots", () => prisma.salesSnapshot.deleteMany({}));

  // --- Internal threads/messages (test) ----------------------------------
  // Participants + messages cascade from Thread.
  await clear("threads", () => prisma.thread.deleteMany({}));

  // --- Email log (test/noise) --------------------------------------------
  await clear("emailLogs", () => prisma.emailLog.deleteMany({}));

  // --- GPS sample data ---------------------------------------------------
  await clear("gpsAlerts", () => prisma.gpsAlert.deleteMany({}));
  await clear("gpsWebhookEvents", () => prisma.gpsWebhookEvent.deleteMany({}));
  await clear("gpsTrips", () => prisma.gpsTrip.deleteMany({}));
  await clear("gpsPositions", () => prisma.gpsPosition.deleteMany({}));
  await clear("gpsSyncLogs", () => prisma.gpsSyncLog.deleteMany({}));

  // --- Manager provisioning ----------------------------------------------
  // 1) Deactivate the fictional placeholder branch managers.
  const deactivated = await prisma.user.updateMany({
    where: { email: { in: PLACEHOLDER_MANAGER_EMAILS } },
    data: { active: false },
  });

  // 2) Re-assert the real branch managers: active + manager access + branch pin
  //    so each lands on their own branch. (reconcileRosterLeaders also promotes
  //    them on deploy; this is a belt-and-suspenders re-assert + warehouse pin.)
  const warehouses = await prisma.warehouse.findMany({ select: { id: true, name: true } });
  const whByName = new Map(warehouses.map((w) => [w.name, w.id] as const));
  const managersProvisioned: string[] = [];
  for (const m of REAL_MANAGERS) {
    const u = await prisma.user.findFirst({ where: { email: m.email } });
    if (!u) continue;
    const warehouseId = u.warehouseId ?? whByName.get(BRANCH_WAREHOUSE[m.branch]) ?? null;
    await prisma.user.update({
      where: { id: u.id },
      data: {
        active: true,
        role: "manager",
        accessLevel: "manager",
        branch: m.branch,
        ...(warehouseId ? { warehouseId } : {}),
      },
    });
    managersProvisioned.push(m.email);
  }

  // Stamp the marker so this can never run twice.
  await prisma.setting.create({ data: { key: MARKER_KEY, value: new Date().toISOString() } });

  const totalCleared = Object.values(cleared).reduce((s, n) => s + n, 0);
  return {
    ran: true,
    totalCleared,
    cleared,
    placeholderManagersDeactivated: deactivated.count,
    managersProvisioned,
  };
}

// Standalone: `FRESH_START_2026_10=1 tsx scripts/fresh-start-2026-10.ts`
if (process.argv[1] && process.argv[1].includes("fresh-start-2026-10")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await freshStart2026(prisma);
      console.log("fresh-start-2026-10:", JSON.stringify(r, null, 2));
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
