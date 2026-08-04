/**
 * Deploy-time database bootstrap. Runs during `npm run build`.
 *
 * - Local / SQLite (DATABASE_URL starts with "file:"): does nothing, so the
 *   local sandbox and `npm run dev` are unaffected.
 * - Postgres (DATABASE_URL starts with "postgres"): flips the Prisma datasource
 *   provider to postgresql (build-time only, not committed), creates the schema
 *   with `prisma db push`, and loads sample data if the database is empty.
 *
 * This lets a fresh Vercel deploy come up fully working with zero manual steps.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";

async function main() {
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    console.log("deploy-db: non-Postgres DATABASE_URL — skipping (local/dev).");
    return;
  }

  // Switch the datasource to Postgres for this build only.
  const schemaPath = join(process.cwd(), "prisma", "schema.prisma");
  const schema = readFileSync(schemaPath, "utf8");
  if (schema.includes('provider = "sqlite"')) {
    writeFileSync(
      schemaPath,
      schema.replace('provider = "sqlite"', 'provider = "postgresql"')
    );
    console.log("deploy-db: switched Prisma provider to postgresql.");
  }

  // Create/align the schema (also regenerates the client for Postgres).
  console.log("deploy-db: running prisma db push…");
  execSync("npx prisma db push --accept-data-loss", { stdio: "inherit" });

  // Seed sample data only when the database is empty; otherwise just backfill
  // any missing standard branches (e.g. Naples) without touching existing data.
  const { PrismaClient } = await import("@prisma/client");
  const { seedDatabase, ensureWarehouses } = await import("../prisma/seed-core");
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.count();
    if (users === 0) {
      const c = await seedDatabase(prisma, { reset: false });
      console.log(
        `deploy-db: seeded ${c.warehouses} warehouses, ${c.technicians} technicians, ${c.products} products.`
      );
    } else {
      const map = await ensureWarehouses(prisma);
      console.log(
        `deploy-db: database already populated (${users} users) — ensured ${map.size} branches exist.`
      );
    }
    // Reconcile the CEO's approved product catalog + unit-of-measure governance
    // on every deploy. Idempotent: upserts the approved products (canonical UoM
    // codes, approved=true) and demotes off-list items to approved=false. Runs
    // after the core seed so products exist to reconcile.
    const { seedApprovedProducts } = await import("../prisma/seed-products-approved");
    const ap = await seedApprovedProducts(prisma);
    console.log(
      `deploy-db: reconciled approved products (${ap.created} created, ${ap.updated} updated, ${ap.demoted} demoted; ${ap.approvedTotal} on catalog).`
    );

    // Backfill VERIFIED EPA registration numbers + official SDS links onto the
    // catalog (from prisma/data/epa-reg-numbers.json + product-sds.json).
    // Idempotent; only fills empty/changed values and NEVER writes a blank over
    // an existing value. Runs after seedApprovedProducts so products exist to
    // match. NON-FATAL — a failure must never fail the build/deploy.
    try {
      const { seedEpaNumbers } = await import("../prisma/seed-epa-numbers");
      const en = await seedEpaNumbers(prisma);
      console.log(
        `deploy-db: EPA/SDS backfill — ${en.epaSet} EPA set (${en.epaUnmatched} unmatched of ${en.epaTotal}), ${en.sdsSet} SDS set (${en.sdsUnmatched} unmatched of ${en.sdsTotal}).`,
      );
    } catch (e) {
      console.error("deploy-db: EPA/SDS backfill FAILED (non-fatal):", e);
    }

    // Load the 4-branch historical purchase data (PestPac transfer histories) as
    // CONFIRMED, analysis-only Invoice + InvoiceLine records. Idempotent (skips
    // invoices whose "HIST-…" number already exists) and — critically — creates
    // NO StockMovement, so current on-hand is never touched. Runs after the
    // approved-product reconcile so every material resolves to a product.
    const { loadPurchaseHistory } = await import("../prisma/seed-purchase-history");
    const beforeMv = await prisma.stockMovement.count();
    const ph = await loadPurchaseHistory(prisma);
    const afterMv = await prisma.stockMovement.count();
    const phInv = ph.reduce((s, r) => s + r.invoicesCreated, 0);
    const phSkip = ph.reduce((s, r) => s + r.invoicesSkipped, 0);
    const phSpend = ph.reduce((s, r) => s + r.totalSpend, 0);
    console.log(
      `deploy-db: loaded purchase history (${phInv} invoices created, ${phSkip} skipped; $${phSpend.toFixed(2)} across ${ph.length} branches; ` +
        `stock movements ${beforeMv}->${afterMv} ${afterMv === beforeMv ? "UNCHANGED" : "CHANGED!"}).`
    );

    // Seed management KPIs only when empty, so uploaded months are never clobbered.
    const kpiValues = await prisma.kpiValue.count();
    if (kpiValues === 0) {
      const { seedManagement } = await import("../prisma/seed-management");
      const m = await seedManagement(prisma);
      console.log(`deploy-db: seeded management KPIs (${m.periods} periods, ${m.values} values).`);
    } else {
      console.log(`deploy-db: management KPIs present (${kpiValues} values) — left as-is.`);
    }

    // Load the June 2026 MBR as a new period. Idempotent + guarded: seedMbrJune
    // only writes when the 2026-06 ReportPeriod is missing, so a later in-app
    // upload or manual correction is never clobbered on redeploy. Runs after the
    // KPI catalog above so the kpiValue→kpi relation is satisfied.
    const { seedMbrJune } = await import("../prisma/seed-mbr");
    const mbr = await seedMbrJune(prisma);
    if (mbr.skipped) {
      console.log("deploy-db: June 2026 MBR already present — left as-is.");
    } else {
      console.log(`deploy-db: loaded June 2026 MBR (${mbr.kpis} KPI values, ${mbr.lob} LOB rows, ${mbr.techs} tech-production rows).`);
    }

    // Branch-level KPIs from the canonical budget model (Branch Frcst) — feeds the
    // manager dashboard branch drill-down + the branch scorecards. Idempotent
    // upsert; re-asserts the model-verified figures on every deploy. Non-fatal.
    try {
      const { seedBranchFrcst } = await import("../prisma/seed-branch-frcst");
      const bf = await seedBranchFrcst(prisma);
      console.log(`deploy-db: branch KPIs (Branch Frcst model) — ${bf.written} values; production YTD roll-up $${bf.branchProductionYtdSum.toLocaleString()} ${bf.reconciles ? "RECONCILES ✓" : "MISMATCH ✗"}.`);
    } catch (e) {
      console.error("deploy-db: branch KPI load FAILED (non-fatal):", e);
    }

    // Re-assert per-branch New Sales (actual + budget) + Attrition (actual) from
    // the June MBR on every deploy, so the branch scorecards keep their
    // branch-specific New Sales targets and book-based cancellation scoring even
    // on a DB seeded before those rows existed. Idempotent upsert; non-fatal.
    try {
      const { seedBranchSalesAttrition } = await import("../prisma/seed-branch-sales-attrition");
      const bsa = await seedBranchSalesAttrition(prisma);
      console.log("deploy-db: branch sales/attrition re-assert —", JSON.stringify(bsa));
    } catch (e) {
      console.error("deploy-db: branch sales/attrition re-assert FAILED (non-fatal):", e);
    }

    // Backfill April 2026 per-branch production (actual + budget) from the May
    // MBR and correct the April company production budget to the MBR figure, so
    // the Q2 branch-manager scorecards reconcile. Upsert (idempotent); always
    // re-asserts the MBR values. Non-fatal so it can never fail a deploy.
    try {
      const { seedScorecardQ2_2026 } = await import("../prisma/seed-scorecard-q2-2026");
      const q2 = await seedScorecardQ2_2026(prisma);
      console.log("deploy-db: Q2 2026 scorecard reconcile —", JSON.stringify(q2));
    } catch (e) {
      console.error("deploy-db: Q2 2026 scorecard reconcile FAILED (non-fatal):", e);
    }

    // Seed the fleet registry only when empty, so re-imports / edits are never clobbered.
    const vehicles = await prisma.vehicle.count();
    if (vehicles === 0) {
      const { seedFleet } = await import("../prisma/seed-fleet");
      const f = await seedFleet(prisma);
      console.log(`deploy-db: seeded fleet (${f.total} vehicles).`);
    } else {
      console.log(`deploy-db: fleet present (${vehicles} vehicles) — left as-is.`);
    }

    // Keep vehicle specs (plate, fuel card, registration) in sync with the fleet
    // sheet on every deploy — non-destructive, so it repairs an older deploy
    // (e.g. plates reconciled from Coast) without touching mileage or disposition.
    const { syncFleetSpecs } = await import("../prisma/seed-fleet");
    const fs = await syncFleetSpecs(prisma);
    console.log(`deploy-db: synced fleet specs — ${fs.updated} vehicle(s) updated.`);

    // Import Coast fuel statements only when empty, so re-imports/edits stay put.
    const fuel = await prisma.fuelTransaction.count();
    if (fuel === 0) {
      const { seedFuel } = await import("../prisma/seed-fuel");
      const fl = await seedFuel(prisma);
      console.log(`deploy-db: imported fuel (${fl.rows} rows, ${fl.linked} linked to vehicles).`);
    } else {
      console.log(`deploy-db: fuel present (${fuel} transactions) — left as-is.`);
    }

    // Seed personnel profiles when empty; otherwise backfill any missing emails
    // and logins from the roster (non-destructive — never overwrites edits). The
    // backfill is what repairs an older deploy that predates the roster emails.
    const employees = await prisma.employee.count();
    if (employees === 0) {
      const { seedEmployees } = await import("../prisma/seed-employees");
      const e = await seedEmployees(prisma);
      console.log(`deploy-db: seeded people (${e.total} employees, ${e.logins} logins).`);
    } else {
      const { syncEmployeeContacts } = await import("../prisma/seed-employees");
      const s = await syncEmployeeContacts(prisma);
      console.log(`deploy-db: people present (${employees}) — backfilled ${s.filled} emails, ${s.hireDates} hire dates, ${s.logins} logins.`);
    }

    // Link each vehicle's existing driver NAME (assignedTo, from the fleet import)
    // to the matching employee record (assignedEmployeeId). Runs after BOTH the
    // fleet and people seeds so both sides exist. Idempotent — only fills vehicles
    // whose FK is still null — so a later manual assign/swap is never clobbered.
    // Non-fatal: a failure must never fail the deploy.
    try {
      const { backfillDriverLinks } = await import("../lib/fleet-driver-link");
      const dl = await backfillDriverLinks();
      console.log(
        `deploy-db: driver links — ${dl.linked} linked, ${dl.alreadyLinked} already linked, ${dl.unmatched} unmatched, ${dl.noName} no name (of ${dl.scanned} active vehicles).`,
      );
    } catch (e) {
      console.error("deploy-db: driver-link backfill FAILED (non-fatal):", e);
    }

    // The owner account is a full admin (sees every center + admin tools).
    const owner = await prisma.user.updateMany({ where: { email: "c.slade@clementspestcontrol.com" }, data: { role: "admin" } });
    console.log(`deploy-db: ensured owner is admin (${owner.count}).`);

    // Seed a sample training course only when none exist.
    const courses = await prisma.course.count();
    if (courses === 0) {
      const { seedTraining } = await import("../prisma/seed-training");
      const t = await seedTraining(prisma);
      console.log(`deploy-db: seeded training (${t.created} course, ${t.assigned} assignments).`);
    } else {
      console.log(`deploy-db: training present (${courses} courses) — left as-is.`);
    }

    // Seed insurance policies only when empty, so edits/uploads aren't clobbered.
    const insurance = await prisma.insurancePolicy.count();
    if (insurance === 0) {
      const { seedInsurance } = await import("../prisma/seed-insurance");
      const ins = await seedInsurance(prisma);
      console.log(`deploy-db: seeded insurance (${ins.total} policies).`);
    } else {
      console.log(`deploy-db: insurance present (${insurance} policies) — left as-is.`);
    }

    // Company bulletin: grant posting rights every deploy (non-destructive) and
    // seed demo posts / calendar / placeholder celebrations when empty.
    const { seedBulletin } = await import("../prisma/seed-bulletin");
    const bl = await seedBulletin(prisma);
    console.log(`deploy-db: bulletin — ${bl.granted} authors, ${bl.posts} posts, ${bl.events} events, ${bl.birthdays} birthdays.`);

    // Senior-leadership access to the Compliance Command Center: grant every
    // deploy (non-destructive, idempotent).
    const { grantSeniorLeadership, grantHrAccess, grantBoardObserver } = await import("../prisma/seed-access");
    const sl = await grantSeniorLeadership(prisma);
    console.log(`deploy-db: senior leadership — ${sl.granted} user(s) granted.`);
    const hr = await grantHrAccess(prisma);
    console.log(`deploy-db: HR access — ${hr.granted} user(s) granted.`);
    const bo = await grantBoardObserver(prisma);
    console.log(`deploy-db: board observers — ${bo.granted} user(s) granted.`);

    // Reconcile the branch hub on every deploy. seedBranchHub is idempotent and
    // self-healing: it keys CPO/business licenses by license number globally, so
    // it repairs an older deploy (a holder assigned to the wrong branch, a
    // missing operator, or leases added after the first seed) without touching
    // manager-uploaded docs or re-storing PDFs that are already on file.
    const { seedBranchHub } = await import("../prisma/seed-branch");
    const bh = await seedBranchHub(prisma);
    console.log(`deploy-db: reconciled branch hub (${bh.created} created, ${bh.updated} updated).`);

    // PTO: give active employees a default annual allotment where HR hasn't set
    // one (non-destructive — only fills nulls), and seed a single demo pending
    // request so the approval flow + calendar have data to show. Both idempotent.
    const allowance = await prisma.employee.updateMany({
      where: { status: "active", ptoAllowanceDays: null },
      data: { ptoAllowanceDays: 10 },
    });
    console.log(`deploy-db: set default PTO allotment on ${allowance.count} employee(s).`);
    const ptoCount = await prisma.ptoRequest.count();
    if (ptoCount === 0) {
      const demoEmp = await prisma.employee.findFirst({
        where: { status: "active", branch: { not: null }, user: { isNot: null } },
        orderBy: { name: "asc" },
      });
      if (demoEmp) {
        const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 10));
        const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 12));
        await prisma.ptoRequest.create({
          data: { employeeId: demoEmp.id, startDate: start, endDate: end, days: 3, type: "vacation", note: "Demo request", status: "pending" },
        });
        console.log(`deploy-db: created demo pending PTO request for ${demoEmp.name}.`);
      }
    } else {
      console.log(`deploy-db: PTO requests present (${ptoCount}) — left as-is.`);
    }

    // Manager oversight checklists: upsert the weekly + monthly templates every
    // deploy (idempotent by key — refreshes item text without touching signed
    // completions, which are append-only).
    const { seedChecklists } = await import("../prisma/seed-checklists");
    const cl = await seedChecklists(prisma);
    console.log(`deploy-db: reconciled oversight checklists (weekly=${cl.weekly} items, monthly=${cl.monthly} items).`);

    // Document center: upsert the employee handbook + manager manual from the
    // Markdown sources every deploy (idempotent by slug — refreshes body/title
    // without touching acknowledgments, which are append-only, or bumping the
    // version).
    const acksBefore = await prisma.documentAcknowledgment.count();
    const { seedDocuments } = await import("../prisma/seed-documents");
    const docs = await seedDocuments(prisma);
    const acksAfter = await prisma.documentAcknowledgment.count();
    console.log(
      `deploy-db: reconciled document center (${docs.map((d) => `${d.slug} v${d.version} ${d.length}c`).join(", ")}; ` +
        `acknowledgments ${acksBefore}->${acksAfter} ${acksAfter === acksBefore ? "UNCHANGED" : "CHANGED"}).`,
    );

    // Backfill public apply tokens on any Job that predates the public
    // application "front door", so every existing job gets a shareable
    // /apply/<token> link. Idempotent — only fills nulls, one unique token each.
    const jobsMissingToken = await prisma.job.findMany({ where: { applyToken: null }, select: { id: true } });
    for (const j of jobsMissingToken) {
      await prisma.job.update({ where: { id: j.id }, data: { applyToken: randomBytes(12).toString("base64url") } });
    }
    console.log(`deploy-db: backfilled apply tokens on ${jobsMissingToken.length} job(s).`);

    // Seed the off-the-shelf Hiring Template Library (interview + screening
    // templates + the categorized question bank). Idempotent — templates are
    // created only when missing (HR edits are never clobbered); bank items are
    // upserted. NON-FATAL: a seed error must NEVER fail the build/deploy — the
    // schema push above is the only hard requirement.
    try {
      const { seedHiringTemplates } = await import("../prisma/seed-hiring-templates");
      const ht = await seedHiringTemplates(prisma);
      console.log(
        `deploy-db: hiring templates — ${ht.templatesCreated} created, ${ht.templatesSkipped} already present (${ht.templatesTotal} off-the-shelf); ${ht.bankUpserted} question-bank items.`,
      );
    } catch (e) {
      console.error("deploy-db: hiring-templates seed FAILED (non-fatal, continuing):", e);
    }

    // Seed the [DEMO] ATS applicant-pipeline walkthrough (idempotent, clearly
    // labeled, removable). Lets the CEO walk shortlist→screening→interview→
    // ranking→selection→pre-hire live on the deployed site.
    // NON-FATAL: a demo-seed failure must NEVER fail the build/deploy (the
    // schema push above is the only hard requirement). Log and continue so
    // production always ships the latest code even if this seed hiccups.
    try {
      const { seedAtsDemo } = await import("../prisma/seed-ats-demo");
      const atsDemo = await seedAtsDemo(prisma);
      console.log(
        `deploy-db: ATS demo — job ${atsDemo.jobId} (${atsDemo.created} candidates created, ${atsDemo.updated} updated; supervisor ${atsDemo.supervisor ?? "n/a"}).`,
      );
    } catch (e) {
      console.error("deploy-db: ATS demo seed FAILED (non-fatal, continuing):", e);
    }

    // Reconcile REAL physical on-hand counts (7/27/2026) for all four branches.
    // Idempotent (guarded by the `onhand_count_2026-07-27` Setting — applies
    // EXACTLY ONCE, ever) and NON-FATAL. Must run AFTER seedApprovedProducts (the
    // catalog must exist to match names) and after warehouses are seeded. Writes
    // only `adjustment` movements = (counted − current); never mutates on-hand.
    try {
      const { seedOnHandCount } = await import("../prisma/seed-onhand-count");
      const r = await seedOnHandCount(prisma);
      console.log("deploy-db: on-hand count 2026-07-27 —", JSON.stringify(r));
    } catch (e) {
      console.error("deploy-db: on-hand count seed FAILED (non-fatal):", e);
    }

    // Remove the "Jordan Rivera" demo new-hire (a placeholder used while building
    // the review flow). Deleting the profile cascades its reviews; the login goes
    // first. Idempotent — a no-op once it's gone. Real reviews are created in-app.
    const demo = await prisma.employee.findFirst({ where: { email: "jordan.rivera@clementspestcontrol.com" } });
    if (demo) {
      await prisma.user.deleteMany({ where: { employeeId: demo.id } });
      await prisma.employee.delete({ where: { id: demo.id } });
      console.log("deploy-db: removed Jordan Rivera demo new-hire.");
    } else {
      console.log("deploy-db: no demo new-hire to remove.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("deploy-db failed:", e);
  process.exit(1);
});
