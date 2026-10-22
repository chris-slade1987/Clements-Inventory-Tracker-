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
import { isDemoModeEnv } from "../lib/demo";

const url = process.env.DATABASE_URL ?? "";

// The schema push is the ONLY hard requirement for a deploy. Once it succeeds
// the app can ship; every seed after it is best-effort. This flag lets the
// top-level handler tell a fatal schema failure (abort) apart from a non-fatal
// post-push seed hiccup (log & continue) instead of ever red-failing on a seed.
let schemaReady = false;

/**
 * Run one post-push seed step in isolation. Every step after the schema push is
 * best-effort: if one throws, we log it and CONTINUE to the next step instead of
 * letting the throw unwind `main()` and silently skip every later seed (the old
 * failure mode — one bad seed would leave the rest of the DB un-seeded on a
 * green deploy). Never rethrows.
 */
async function runStep(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`deploy-db: ${label} FAILED (non-fatal, continuing):`, e);
  }
}

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

  // PREVIEW / non-production Vercel builds: never run DDL or seeds against the
  // shared database, and a preview's DATABASE_URL often has no usable DIRECT
  // endpoint for `prisma db push` — which is exactly why preview builds were
  // failing ("npm run build exited with 1"). Regenerate the Postgres client so the
  // app still compiles and runs, then STOP before any schema push / seed. Only a
  // real Production deploy migrates + seeds. (No VERCEL_ENV → not on Vercel, e.g.
  // a manual/CI run, so fall through and behave as before.)
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    console.log(`deploy-db: VERCEL_ENV=${process.env.VERCEL_ENV} — regenerating client only; skipping schema push + seeds (previews never mutate the shared DB).`);
    try {
      execSync("npx --no-install prisma generate", { stdio: "inherit" });
    } catch (e) {
      console.warn("deploy-db: prisma generate (preview) warning:", (e as Error).message);
    }
    return;
  }

  // Create/align the schema (also regenerates the client for Postgres).
  // Pin the CLI to the installed 6.x: a bare `npx prisma` can resolve to a
  // freshly-published Prisma 7, which rejects this v6 schema (and the
  // `package.json#prisma` config) and hard-fails the build.
  // Schema migrations (DDL) must run over a DIRECT connection — a Neon/pgBouncer
  // POOLED endpoint can hang or reject DDL. Prefer an explicit direct URL, else
  // derive one by dropping the `-pooler` host segment; runtime queries keep using
  // the (hardened) pooled DATABASE_URL. Only the db-push subprocess is affected.
  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || url.replace("-pooler.", ".");
  console.log("deploy-db: running prisma db push (direct connection)…");
  execSync("npx --no-install prisma db push --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: directUrl },
  });
  schemaReady = true;

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

    // GHP CEU — "Roach Identification — The Clements Way" — seeded FIRST, right
    // after the core seed, so NOTHING downstream can preempt it: deploy-db runs
    // many seeds in sequence and an un-wrapped throw exits the script (green
    // deploy, but every later step skipped). Only the schema push + core seed
    // precede this. Idempotent by title: creates the course if missing,
    // self-heals a stale/placeholder body to the photo version (even if it was
    // content-locked by testing Edit), assigns to active technicians, and
    // retires the old sample placeholder course. NON-FATAL.
    try {
      const { seedTrainingGhp } = await import("../prisma/seed-training-ghp");
      const g = await seedTrainingGhp(prisma);
      const state = g.created ? "CREATED" : g.locked ? "content-locked (left as-is)" : "refreshed";
      console.log(
        `deploy-db: GHP roach-ID CEU — ${state} (${g.bodyChars}c body, ${g.questions} questions); ` +
          `assigned to ${g.assigned} new of ${g.technicians} technician(s).`,
      );
      const sample = await prisma.course.findFirst({ where: { title: "Monthly Safety Refresher — Pesticide Handling" } });
      if (sample) {
        await prisma.trainingAssignment.deleteMany({ where: { courseId: sample.id } });
        await prisma.course.delete({ where: { id: sample.id } });
        console.log("deploy-db: retired the demo sample training course (Monthly Safety Refresher).");
      }
    } catch (e) {
      console.error("deploy-db: GHP CEU seed FAILED (non-fatal):", e);
    }

    // Sales Team: give every Service Advisor login the `sales` access level, so
    // they get the sales dashboard + goal planner. Runs early (before the seeds
    // that can abort). Idempotent + non-fatal; never downgrades a leader.
    try {
      const { seedSalesTeamAccess } = await import("../prisma/seed-sales");
      const st = await seedSalesTeamAccess(prisma);
      console.log(
        `deploy-db: sales team — ${st.updated} of ${st.advisors} advisor login(s) → Service Advisor` +
          `${st.directorSet ? `; ${st.directorSet} → Sales Director` : ""}` +
          `${st.exampleCreated ? `; example goal sheet created (${st.periodKey})` : ""}.`,
      );
    } catch (e) {
      console.error("deploy-db: sales team access seed FAILED (non-fatal):", e);
    }

    // One-time admin password reset / ensure — gated by an env var the operator
    // sets in Vercel and REMOVES afterward. Recovers a forgotten owner password
    // AND a missing owner account (e.g. a re-seeded DB). Sets super_admin + active.
    // Never logs the password. NON-FATAL. While the env var stays set it re-applies
    // on every deploy, so remove it once you can log in.
    const forcePw = process.env.FORCE_ADMIN_PASSWORD?.trim();
    if (forcePw) {
      try {
        const { hashPassword, MANAGER_EMAIL } = await import("../prisma/seed-core");
        const email = (process.env.FORCE_ADMIN_EMAIL?.trim() || MANAGER_EMAIL).toLowerCase();
        const passwordHash = hashPassword(forcePw);
        const existing = await prisma.user.findFirst({ where: { email } });
        if (existing) {
          await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, role: "admin", accessLevel: "super_admin", active: true } });
          console.log(`deploy-db: FORCE_ADMIN_PASSWORD set — reset password + ensured super_admin for ${email}. REMOVE this env var now and redeploy.`);
        } else {
          const wh = await prisma.warehouse.findFirst({ select: { id: true } });
          await prisma.user.create({ data: { name: "Chris Slade", email, passwordHash, role: "admin", accessLevel: "super_admin", active: true, warehouseId: wh?.id } });
          console.log(`deploy-db: FORCE_ADMIN_PASSWORD set — created super_admin ${email}. REMOVE this env var now and redeploy.`);
        }
      } catch (e) {
        console.error("deploy-db: FORCE_ADMIN_PASSWORD reset FAILED (non-fatal):", e);
      }
    }
    // Reconcile the CEO's approved product catalog + unit-of-measure governance
    // on every deploy. Idempotent: upserts the approved products (canonical UoM
    // codes, approved=true) and demotes off-list items to approved=false. Runs
    // after the core seed so products exist to reconcile.
    await runStep("approved-products reconcile", async () => {
      const { seedApprovedProducts } = await import("../prisma/seed-products-approved");
      const ap = await seedApprovedProducts(prisma);
      console.log(
        `deploy-db: reconciled approved products (${ap.created} created, ${ap.updated} updated, ${ap.demoted} demoted; ${ap.approvedTotal} on catalog).`
      );
    });

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

    // Reconcile the check-out (chemical dispersement) roster with employment
    // status: deactivate any technician whose name matches a terminated employee,
    // catching people offboarded before the termination→technician sync existed.
    // NON-FATAL.
    try {
      const { reconcileTerminatedTechnicians } = await import("../lib/separation");
      const deactivated = await reconcileTerminatedTechnicians();
      console.log(`deploy-db: dispersement roster reconcile — ${deactivated} technician(s) of terminated employees deactivated.`);
    } catch (e) {
      console.error("deploy-db: dispersement roster reconcile FAILED (non-fatal):", e);
    }

    // Load the 4-branch historical purchase data (PestPac transfer histories) as
    // CONFIRMED, analysis-only Invoice + InvoiceLine records. Idempotent (skips
    // invoices whose "HIST-…" number already exists) and — critically — creates
    // NO StockMovement, so current on-hand is never touched. Runs after the
    // approved-product reconcile so every material resolves to a product.
    // The Aug/Sep purchase + dispersal + 7/31 history loaders below are SUPERSEDED
    // by the reconciled "inventory reset 2026-10" step (near the end). Once that has
    // applied (Setting marker), these legacy loaders are skipped so they never
    // re-add data the reset wiped. On-hand = July count + Aug/Sep receipts − issues,
    // all from prisma/data/inventory-reset/.
    const INV_RESET_APPLIED = !!(await prisma.setting.findUnique({ where: { key: "inventory_reset_2026_10" } }));
    if (!INV_RESET_APPLIED) await runStep("purchase-history load", async () => {
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
    });

    // Seed management KPIs only when empty, so uploaded months are never clobbered.
    await runStep("management KPI seed", async () => {
      const kpiValues = await prisma.kpiValue.count();
      if (kpiValues === 0) {
        const { seedManagement } = await import("../prisma/seed-management");
        const m = await seedManagement(prisma);
        console.log(`deploy-db: seeded management KPIs (${m.periods} periods, ${m.values} values).`);
      } else {
        console.log(`deploy-db: management KPIs present (${kpiValues} values) — left as-is.`);
      }
    });

    // Load the June 2026 MBR as a new period. Idempotent + guarded: seedMbrJune
    // only writes when the 2026-06 ReportPeriod is missing, so a later in-app
    // upload or manual correction is never clobbered on redeploy. Runs after the
    // KPI catalog above so the kpiValue→kpi relation is satisfied.
    await runStep("June 2026 MBR load", async () => {
      const { seedMbrJune } = await import("../prisma/seed-mbr");
      const mbr = await seedMbrJune(prisma);
      if (mbr.skipped) {
        console.log("deploy-db: June 2026 MBR already present — left as-is.");
      } else {
        console.log(`deploy-db: loaded June 2026 MBR (${mbr.kpis} KPI values, ${mbr.lob} LOB rows, ${mbr.techs} tech-production rows).`);
      }
    });

    // Load the July + August + September 2026 MBRs (September from the Oct 2026 MBR /
    // September financials). Same guarded, idempotent loader — only writes a period
    // that's missing, so a later in-app upload/correction is never clobbered. July is
    // derived where the source is YTD-only (production + P&L via YTD deltas); new-sales,
    // attrition and book value are real monthly columns from the report. NON-FATAL each.
    try {
      const { seedMbrFromFile } = await import("../prisma/seed-mbr");
      for (const base of ["mbr-2026-07", "mbr-2026-08", "mbr-2026-09"]) {
        const r = await seedMbrFromFile(prisma, base);
        console.log(
          r.skipped
            ? `deploy-db: ${base} already present — left as-is.`
            : `deploy-db: loaded ${base} (${r.kpis} KPI values, ${r.lob} LOB rows, ${r.techs} tech rows).`,
        );
      }
    } catch (e) {
      console.error("deploy-db: July/August MBR load FAILED (non-fatal):", e);
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

    // Load the CEO's 2026 Branch KPIs workbook (per-branch MONTHLY production /
    // new-sales / cancellation targets + Q1 actuals) into BranchKpiTarget. Powers
    // the quarterly scorecard targets (Q1–Q4) and the dashboard forecast lines.
    // Idempotent upsert; non-fatal.
    try {
      const { seedBranchKpis } = await import("../prisma/seed-branch-kpis");
      const bk = await seedBranchKpis(prisma);
      console.log("deploy-db: branch KPI targets (2026 workbook) —", JSON.stringify(bk));
    } catch (e) {
      console.error("deploy-db: branch KPI targets load FAILED (non-fatal):", e);
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
    await runStep("fleet seed", async () => {
      const vehicles = await prisma.vehicle.count();
      if (vehicles === 0) {
        const { seedFleet } = await import("../prisma/seed-fleet");
        const f = await seedFleet(prisma);
        console.log(`deploy-db: seeded fleet (${f.total} vehicles).`);
      } else {
        console.log(`deploy-db: fleet present (${vehicles} vehicles) — left as-is.`);
      }
    });

    // Keep vehicle specs (plate, fuel card, registration) in sync with the fleet
    // sheet on every deploy — non-destructive, so it repairs an older deploy
    // (e.g. plates reconciled from Coast) without touching mileage or disposition.
    await runStep("fleet specs sync", async () => {
      const { syncFleetSpecs } = await import("../prisma/seed-fleet");
      const fs = await syncFleetSpecs(prisma);
      console.log(`deploy-db: synced fleet specs — ${fs.updated} vehicle(s) updated.`);
    });

    // Import Coast fuel statements only when empty, so re-imports/edits stay put.
    await runStep("fuel import", async () => {
      const fuel = await prisma.fuelTransaction.count();
      if (fuel === 0) {
        const { seedFuel } = await import("../prisma/seed-fuel");
        const fl = await seedFuel(prisma);
        console.log(`deploy-db: imported fuel (${fl.rows} rows, ${fl.linked} linked to vehicles).`);
      } else {
        console.log(`deploy-db: fuel present (${fuel} transactions) — left as-is.`);
      }
    });

    // Seed personnel profiles when empty; otherwise backfill any missing emails
    // and logins from the roster (non-destructive — never overwrites edits). The
    // backfill is what repairs an older deploy that predates the roster emails.
    await runStep("people seed/backfill", async () => {
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
    });

    // Bootstrap the org-chart reporting lines (non-destructive; only fills a blank
    // reportsToId). Runs after people are seeded so employees exist to link. Non-fatal.
    try {
      const { seedOrgChart } = await import("../prisma/seed-org-chart");
      const oc = await seedOrgChart(prisma);
      console.log(`deploy-db: org chart — linked ${oc.linked} reporting line(s).`);
    } catch (e) {
      console.error("deploy-db: org chart bootstrap FAILED (non-fatal):", e);
    }

    // Seed the org roster (CEO's Org Chart sheet) FIRST — it sets authoritative
    // per-person access levels + roles (fill-if-null) from the sheet, so real
    // branch managers get level "manager" (role manager) before the generic
    // backfill can default them to "technician". Idempotent; non-fatal.
    try {
      const { seedOrgRoster } = await import("../prisma/seed-org-roster");
      const or = await seedOrgRoster(prisma);
      console.log("deploy-db: org roster —", JSON.stringify(or));
    } catch (e) {
      console.error("deploy-db: org roster seed FAILED (non-fatal):", e);
    }

    // Backfill access levels from role for anyone STILL null (runs AFTER the
    // roster so it only touches people the roster didn't cover). Idempotent; non-fatal.
    try {
      const { backfillAccessLevels } = await import("../prisma/seed-access-levels");
      const al = await backfillAccessLevels(prisma);
      console.log("deploy-db: access levels backfilled —", JSON.stringify(al));
    } catch (e) {
      console.error("deploy-db: access-level backfill FAILED (non-fatal):", e);
    }

    // Corrective (upgrade-only): promote any roster leader (manager /
    // sales_director / admin / super_admin) whose login is stuck at the default
    // "technician" from an earlier deploy where the backfill ran before the
    // roster. Fixes the "real managers deploy as technicians" bug on an existing
    // DB without downgrading anyone. Idempotent; non-fatal.
    try {
      const { reconcileRosterLeaders } = await import("../prisma/seed-org-roster");
      const rl = await reconcileRosterLeaders(prisma);
      console.log("deploy-db: roster leader reconcile —", JSON.stringify(rl));
    } catch (e) {
      console.error("deploy-db: roster leader reconcile FAILED (non-fatal):", e);
    }

    // Load technician/field route numbers onto Employee records from the COO's
    // phone-list (prisma/data/tech-numbers.json). MUST run AFTER the people seeds
    // (seedEmployees + seedOrgRoster) so every employee already exists to match —
    // running it earlier matched nobody on the deploy that created them, which is
    // why route numbers were blank on profiles + org tiles. Idempotent,
    // name-matched, never creates people; unmatched/ambiguous names logged. NON-FATAL.
    try {
      const { importTechNumbers } = await import("../prisma/seed-tech-numbers");
      const t = await importTechNumbers(prisma);
      console.log(
        `deploy-db: tech route-numbers — ${t.updated} set, ${t.alreadySet} already current, of ${t.total}; ` +
          `unmatched: ${t.unmatched.join(", ") || "none"}; ambiguous: ${t.ambiguous.join(", ") || "none"}.`
      );
    } catch (e) {
      console.error("deploy-db: tech route-number import FAILED (non-fatal):", e);
    }

    // Self-healing org-chart catch-all: after the authoritative roster + branch
    // bootstrap, attach any employee STILL missing a reporting line to their
    // branch manager (or the company top) so nobody renders as a stray root.
    // Fill-if-null only; runs last among the org steps. Idempotent; non-fatal.
    try {
      const { seedLeadershipRoots, attachRemainingReports } = await import("../prisma/seed-org-chart");
      const lr = await seedLeadershipRoots(prisma);
      console.log(`deploy-db: org chart — pinned ${lr.roots} company root(s) to the top (cleared ${lr.cleared}).`);
      const ar = await attachRemainingReports(prisma);
      console.log(`deploy-db: org chart — repaired ${ar.repaired} dangling line(s), attached ${ar.linked} remaining report(s) to a manager.`);
    } catch (e) {
      console.error("deploy-db: org chart catch-all FAILED (non-fatal):", e);
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

    // Leadership super admins — bulletproof, every deploy. Force each to a TRUE
    // super admin: role "admin" + accessLevel "super_admin" + NO home branch (so
    // they're never branch-locked / pinned to one branch) and active. This fixes
    // an account that drifted to manager/branch-locked (which silently removed the
    // Sales Team portal and pinned KPIs to one branch). Idempotent, un-guarded.
    await runStep("super admins ensure", async () => {
      const SUPER_ADMIN_EMAILS = [
        "c.slade@clementspestcontrol.com", // Chris — COO
        "tslade@clementspestcontrol.com", // Tim — President
        "jglanville@clementspestcontrol.com", // Julie — Chief of Staff
        "awilliford@clementspestcontrol.com", // April — Director of HR
        "manager@clementspest.com", // shared admin login
      ];
      const r = await prisma.user.updateMany({
        where: { email: { in: SUPER_ADMIN_EMAILS } },
        data: { role: "admin", accessLevel: "super_admin", branch: null, warehouseId: null, active: true },
      });
      console.log(`deploy-db: ensured ${r.count} leadership super admin(s) (role admin / super_admin / all-branch).`);
    });

    // Seed a sample training course only when none exist.
    await runStep("training seed", async () => {
      const courses = await prisma.course.count();
      if (courses === 0) {
        const { seedTraining } = await import("../prisma/seed-training");
        const t = await seedTraining(prisma);
        console.log(`deploy-db: seeded training (${t.created} course, ${t.assigned} assignments).`);
      } else {
        console.log(`deploy-db: training present (${courses} courses) — left as-is.`);
      }
    });

    // Seed insurance policies only when empty, so edits/uploads aren't clobbered.
    await runStep("insurance seed", async () => {
      const insurance = await prisma.insurancePolicy.count();
      if (insurance === 0) {
        const { seedInsurance } = await import("../prisma/seed-insurance");
        const ins = await seedInsurance(prisma);
        console.log(`deploy-db: seeded insurance (${ins.total} policies).`);
      } else {
        console.log(`deploy-db: insurance present (${insurance} policies) — left as-is.`);
      }
    });

    // Company bulletin: grant posting rights every deploy (non-destructive) and
    // seed demo posts / calendar / placeholder celebrations when empty.
    await runStep("bulletin seed", async () => {
      const { seedBulletin } = await import("../prisma/seed-bulletin");
      const bl = await seedBulletin(prisma);
      console.log(`deploy-db: bulletin — ${bl.granted} authors, ${bl.posts} posts, ${bl.events} events, ${bl.birthdays} birthdays.`);
    });

    // Senior-leadership access to the Compliance Command Center: grant every
    // deploy (non-destructive, idempotent).
    await runStep("access grants", async () => {
      const { grantSeniorLeadership, grantHrAccess, grantBoardObserver } = await import("../prisma/seed-access");
      const sl = await grantSeniorLeadership(prisma);
      console.log(`deploy-db: senior leadership — ${sl.granted} user(s) granted.`);
      const hr = await grantHrAccess(prisma);
      console.log(`deploy-db: HR access — ${hr.granted} user(s) granted.`);
      const bo = await grantBoardObserver(prisma);
      console.log(`deploy-db: board observers — ${bo.granted} user(s) granted.`);
    });

    // Seed the admin-editable inventory-escalation email list (if not already
    // set), so who gets pulled into a stock-out escalation can be changed from
    // the settings API without a code deploy. Only creates it when missing —
    // never overwrites an admin's edit. NON-FATAL.
    await runStep("inventory escalation setting", async () => {
      const { INVENTORY_ESCALATION_EMAILS, INVENTORY_ESCALATION_SETTING } = await import("../lib/threads");
      const existing = await prisma.setting.findUnique({ where: { key: INVENTORY_ESCALATION_SETTING } });
      if (!existing) {
        await prisma.setting.create({ data: { key: INVENTORY_ESCALATION_SETTING, value: [...INVENTORY_ESCALATION_EMAILS].join(",") } });
        console.log("deploy-db: seeded inventory escalation email setting (default list).");
      } else {
        console.log("deploy-db: inventory escalation email setting present — left as-is.");
      }
    });

    // Reconcile the branch hub on every deploy. seedBranchHub is idempotent and
    // self-healing: it keys CPO/business licenses by license number globally, so
    // it repairs an older deploy (a holder assigned to the wrong branch, a
    // missing operator, or leases added after the first seed) without touching
    // manager-uploaded docs or re-storing PDFs that are already on file.
    await runStep("branch hub reconcile", async () => {
      const { seedBranchHub } = await import("../prisma/seed-branch");
      const bh = await seedBranchHub(prisma);
      console.log(`deploy-db: reconciled branch hub (${bh.created} created, ${bh.updated} updated).`);
    });

    // PTO: give active employees a default annual allotment where HR hasn't set
    // one (non-destructive — only fills nulls). Idempotent.
    await runStep("PTO allotment backfill", async () => {
      const allowance = await prisma.employee.updateMany({
        where: { status: "active", ptoAllowanceDays: null },
        data: { ptoAllowanceDays: 10 },
      });
      console.log(`deploy-db: set default PTO allotment on ${allowance.count} employee(s).`);
    });

    // Demo PTO request — DEMO MODE ONLY. Seeds a single pending request so the
    // approval flow + calendar have data during a live walkthrough. Never seeded
    // in production (real PTO is entered in-app); gated by DEMO_MODE=1.
    if (isDemoModeEnv()) {
      await runStep("demo PTO request", async () => {
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
              data: { employeeId: demoEmp.id, startDate: start, endDate: end, days: 3, type: "vacation", note: "[DEMO] request", status: "pending" },
            });
            console.log(`deploy-db: [demo] created demo pending PTO request for ${demoEmp.name}.`);
          }
        } else {
          console.log(`deploy-db: PTO requests present (${ptoCount}) — left as-is.`);
        }
      });
    }

    // Manager oversight checklists: upsert the weekly + monthly templates every
    // deploy (idempotent by key — refreshes item text without touching signed
    // completions, which are append-only).
    await runStep("oversight checklists reconcile", async () => {
      const { seedChecklists } = await import("../prisma/seed-checklists");
      const cl = await seedChecklists(prisma);
      console.log(`deploy-db: reconciled oversight checklists (weekly=${cl.weekly} items, monthly=${cl.monthly} items).`);
    });

    // SOP library (CanopyOS Theme 2) — upsert the example Standard Operating
    // Procedures by key (idempotent, never touches signed completions or the
    // assignment ledger) and seed one open Branch Open/Close assignment per branch
    // so the "Due now" surface is real on a fresh deploy. NON-FATAL.
    await runStep("SOP library reconcile", async () => {
      const { seedSops, seedSopAssignments } = await import("../prisma/seed-sops");
      const sops = await seedSops(prisma);
      const asg = await seedSopAssignments(prisma);
      console.log(
        `deploy-db: reconciled SOP library (${Object.entries(sops).map(([k, v]) => `${k}=${v} steps`).join(", ")}; ${asg} open assignment(s) created).`,
      );
    });

    // Groundwork (Round 1-A): upsert the Huddle agenda templates (Sales Director
    // Weekly, Marketing, Branch/Ops, 1:1) every deploy. Idempotent by key —
    // refreshes name/items without duplicating. NON-FATAL.
    await runStep("agenda templates reconcile", async () => {
      const { seedAgendaTemplates } = await import("../prisma/seed-agenda-templates");
      const at = await seedAgendaTemplates(prisma);
      console.log(`deploy-db: reconciled Huddle agenda templates (${at.upserted} templates).`);
    });

    // Document center: upsert the employee handbook + manager manual from the
    // Markdown sources every deploy (idempotent by slug — refreshes body/title
    // without touching acknowledgments, which are append-only, or bumping the
    // version).
    await runStep("document center reconcile", async () => {
      const acksBefore = await prisma.documentAcknowledgment.count();
      const { seedDocuments } = await import("../prisma/seed-documents");
      const docs = await seedDocuments(prisma);
      const acksAfter = await prisma.documentAcknowledgment.count();
      console.log(
        `deploy-db: reconciled document center (${docs.map((d) => `${d.slug} v${d.version} ${d.length}c`).join(", ")}; ` +
          `acknowledgments ${acksBefore}->${acksAfter} ${acksAfter === acksBefore ? "UNCHANGED" : "CHANGED"}).`,
      );
    });

    // Canopy Copilot knowledge base (Theme 5, Wave A): rebuild the retrieval
    // index from the core documents. Runs AFTER the SOP, checklist, and document
    // center reconciles above so every corpus source (manual, handbook, SOPs,
    // checklists) is present + current, and from the build workspace so the
    // docs/*.md sources (brand kit, etc.) are on disk. Idempotent (upserts by
    // content hash; a re-run is zero-change) and soft-retires stale chunks —
    // never hard-deletes. NON-FATAL via runStep. Only a real Production deploy
    // reaches here (previews return above), mirroring the other seed guards.
    await runStep("copilot knowledge reindex", async () => {
      const { reindexKnowledge } = await import("../lib/copilot/ingest");
      const r = await reindexKnowledge();
      console.log(
        `deploy-db: copilot knowledge reindex — ${r.scanned} chunks across ${r.sources} sources ` +
          `(${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged, ${r.retired} retired).`,
      );
    });

    // Training Center catalog — seed the Program → Module → Course reference data
    // (10 certifications, 5 programs, 17 modules, 91 courses, 40 program-module +
    // 357 module-course links) from prisma/data/training-catalog.json. All upserts
    // are idempotent (keyed by code/join), so this runs every deploy with no marker
    // and never touches the per-employee assignment/progress tables. NON-FATAL.
    await runStep("training catalog seed", async () => {
      const { seedTrainingCatalog } = await import("../prisma/seed-training-catalog");
      const cat = await seedTrainingCatalog(prisma);
      console.log(
        `deploy-db: training catalog — ${cat.certifications} certifications, ${cat.programs} programs, ${cat.modules} modules, ${cat.courses} courses, ${cat.programModules} program-module + ${cat.moduleCourses} module-course links.`,
      );
    });

    // Corporate role reference (Org Chart R4) — version-gated one-time backfill of
    // the Contact & Reference Sheet onto matching employees' cards. Preserves later
    // manager edits (skips once the stored version matches the data file).
    await runStep("corporate roles seed", async () => {
      const { seedCorporateRoles } = await import("../prisma/seed-corporate-roles");
      const cr = await seedCorporateRoles(prisma);
      if (cr.skipped) {
        console.log(`deploy-db: corporate roles — already at v${cr.version}, skipped.`);
      } else {
        console.log(`deploy-db: corporate roles — v${cr.version}, matched ${cr.matched}/${cr.total}, failed ${cr.failed ?? 0}${cr.unmatched.length ? `, unmatched: ${cr.unmatched.join("; ")}` : ""}.`);
      }
    });

    // Backfill public apply tokens on any Job that predates the public
    // application "front door", so every existing job gets a shareable
    // /apply/<token> link. Idempotent — only fills nulls, one unique token each.
    await runStep("apply-token backfill", async () => {
      const jobsMissingToken = await prisma.job.findMany({ where: { applyToken: null }, select: { id: true } });
      for (const j of jobsMissingToken) {
        await prisma.job.update({ where: { id: j.id }, data: { applyToken: randomBytes(12).toString("base64url") } });
      }
      console.log(`deploy-db: backfilled apply tokens on ${jobsMissingToken.length} job(s).`);
    });

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

    // Seed the [DEMO] ATS applicant-pipeline walkthrough — DEMO MODE ONLY.
    // Lets the CEO walk shortlist→screening→interview→ranking→selection→pre-hire
    // live during a demo. Never seeded in production (real candidates come in via
    // the public apply flow); gated by DEMO_MODE=1. Idempotent + non-fatal.
    if (isDemoModeEnv()) {
      await runStep("ATS demo seed", async () => {
        const { seedAtsDemo } = await import("../prisma/seed-ats-demo");
        const atsDemo = await seedAtsDemo(prisma);
        console.log(
          `deploy-db: [demo] ATS demo — job ${atsDemo.jobId} (${atsDemo.created} candidates created, ${atsDemo.updated} updated; supervisor ${atsDemo.supervisor ?? "n/a"}).`,
        );
      });
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
    await runStep("Jordan Rivera demo removal", async () => {
      const demo = await prisma.employee.findFirst({ where: { email: "jordan.rivera@clementspestcontrol.com" } });
      if (demo) {
        await prisma.user.deleteMany({ where: { employeeId: demo.id } });
        await prisma.employee.delete({ where: { id: demo.id } });
        console.log("deploy-db: removed Jordan Rivera demo new-hire.");
      } else {
        console.log("deploy-db: no demo new-hire to remove.");
      }
    });

    // Oct 1, 2026 "full fresh start" — one-time, operator-gated production
    // cleanup for the manager/director launch. INERT unless FRESH_START_2026_10=1
    // is set in the environment, and applies EXACTLY ONCE (Setting-marker
    // guarded). Runs LAST so it clears operational/test data after every seed.
    // Clears inspections, checklist runs, audits, alerts/reminders, test PTO/
    // sales/threads/candidates/personnel records, etc.; KEEPS inventory, people,
    // logins, financials, fleet/insurance/branch-hub reference, templates,
    // courses, bulletin, holidays, and policy documents. Provisions the real
    // branch managers + deactivates placeholders. NON-FATAL.
    await runStep("fresh-start 2026-10 (gated)", async () => {
      const { freshStart2026 } = await import("./fresh-start-2026-10");
      const fresh = await freshStart2026(prisma);
      console.log("deploy-db: fresh-start 2026-10 —", JSON.stringify(fresh));
    });

    // Default-password policy rollout. Ensures every active employee with an email
    // has a login, repairs empty/placeholder passwords (e.g. April), guarantees the
    // four leadership logins (April/Julie/Howard/Graham) can sign in with the
    // default password, and ONE TIME flags all active logins except the owner as
    // mustChangePassword. Idempotent + non-fatal. Runs LAST so it covers logins
    // created/provisioned by every seed above (incl. the gated fresh-start).
    // Clear onboarding reviews for anyone hired before the new-hire review program
    // started (REVIEW_PROGRAM_START) — existing staff shouldn't carry a 30/60-day
    // onboarding review. Idempotent; completed reviews are preserved.
    await runStep("clear pre-program new-hire reviews", async () => {
      const { clearPreProgramReviews } = await import("../lib/jobs");
      const res = await clearPreProgramReviews();
      console.log("deploy-db: pre-program reviews cleared —", JSON.stringify(res));
    });

    // One-time 7/31/2026 on-hand reconciliation — resets every branch's inventory
    // to the uploaded workbook snapshot via dated `adjustment` movements (owner
    // authorized an automatic apply, no manual step). Idempotent: the Setting
    // marker `onhand_reconcile_2026-07-31` makes it apply EXACTLY ONCE; re-runs
    // recompute to zero deltas and no-op. Non-fatal (retries next deploy if it
    // ever throws). Never hard-deletes; Confirm/adjustment audit trail preserved.
    if (!INV_RESET_APPLIED) await runStep("7/31 on-hand reconciliation", async () => {
      const { reconcileOnHand20260731, APPLY_ENV } = await import("./reconcile-onhand-2026-07-31");
      process.env[APPLY_ENV] = "1";
      const r = await reconcileOnHand20260731(prisma, { apply: true });
      console.log(
        "deploy-db: 7/31 on-hand reconciliation —",
        r.applied ? `APPLIED ${JSON.stringify(r.totals)}` : `skipped (${r.reason ?? "already applied"})`,
      );
    });

    // Load distributor purchase invoices (prisma/data/purchase-invoices/*.json) as
    // incremental CONFIRMED receipts ON TOP of the 7/31 baseline. Runs AFTER the
    // 7/31 reconciliation so those check-ins add to the reconciled on-hand. Branch
    // is resolved PER INVOICE from its own column (never assumed). Idempotent per
    // (distributor, invoiceNumber) — redeploys skip invoices already loaded — so
    // the auto-apply is safe to re-run. Non-fatal. Positive check_in for receipts;
    // vendor credits post a negative adjustment; never hard-deletes.
    if (!INV_RESET_APPLIED) await runStep("purchase-invoice load", async () => {
      const { loadPurchaseInvoices } = await import("./load-purchase-invoices");
      const beforeMv = await prisma.stockMovement.count();
      const r = await loadPurchaseInvoices(prisma, { apply: true });
      const afterMv = await prisma.stockMovement.count();
      const created = r.files.reduce(
        (s, f) => s + Object.values(f.perBranch).reduce((a, b) => a + b.invoicesCreated, 0),
        0,
      );
      const skipped = r.files.reduce(
        (s, f) => s + Object.values(f.perBranch).reduce((a, b) => a + b.invoicesSkipped, 0),
        0,
      );
      console.log(
        `deploy-db: purchase invoices — ${created} loaded, ${skipped} already-loaded; ` +
          `${r.matchedProducts.size} matched / ${r.createdProducts.size} created / ${r.unmatched.size} unmatched products; ` +
          `movements ${beforeMv}->${afterMv}` +
          (r.errors.length ? ` | ${r.errors.length} STOP/ERROR` : "") +
          (r.duplicateInvoiceWarnings.length ? ` | ${r.duplicateInvoiceWarnings.length} dup-warning` : ""),
      );
      if (r.errors.length) for (const e of r.errors) console.error("deploy-db: purchase-invoice", e);
    });

    // Load warehouse->technician dispersals (prisma/data/dispersals/*.json) as
    // negative check_out movements ON TOP of the baseline + purchase receipts.
    // Runs AFTER the purchase-invoice load so dispersals draw down the fully
    // received on-hand. Branch is resolved PER ROW from its own column; products
    // match via the PestPac alias map (unmatched rows are reported, not loaded);
    // technicians are resolved by card # or created. Idempotent per file via the
    // `dispersal_load:<loadKey>` Setting marker — redeploys skip loaded files — so
    // the auto-apply is safe to re-run. Negative on-hand is recorded, not blocked
    // (it reveals a baseline/receipts gap). Non-fatal.
    if (!INV_RESET_APPLIED) await runStep("dispersal load", async () => {
      const { loadDispersals } = await import("./load-dispersals");
      const beforeMv = await prisma.stockMovement.count();
      const r = await loadDispersals(prisma, { apply: true });
      const afterMv = await prisma.stockMovement.count();
      const loaded = r.files.reduce(
        (s, f) => s + Object.values(f.perBranch).reduce((a, b) => a + b.rowsLoaded, 0),
        0,
      );
      const skippedFiles = r.files.filter((f) => f.alreadyLoaded).length;
      console.log(
        `deploy-db: dispersals — ${loaded} rows loaded across ${r.files.length - skippedFiles} file(s), ${skippedFiles} already-loaded; ` +
          `${r.matchedProducts.size} products matched / ${r.unmatched.size} unmatched; ` +
          `${r.techsMatched} techs matched / ${r.techsCreated.length} created; ` +
          `movements ${beforeMv}->${afterMv}` +
          (r.negativeOnHand.length ? ` | ${r.negativeOnHand.length} product(s) now negative on-hand` : "") +
          (r.errors.length ? ` | ${r.errors.length} STOP/ERROR` : ""),
      );
      if (r.errors.length) for (const e of r.errors) console.error("deploy-db: dispersal", e);
    });

    // Scan-to-issue (inventory checkout) backfills. Idempotent + Setting-marker
    // guarded so they apply once; the standalone scripts in scripts/ can re-run
    // them anytime. Runs after the catalog + distributor loads so products exist.
    await runStep("scan-to-issue backfills", async () => {
      const marker = await prisma.setting.findUnique({ where: { key: "scan_issue_backfill_v1" } });
      if (marker) {
        console.log("deploy-db: scan-to-issue backfills already applied — left as-is.");
        return;
      }
      const { backfillProductBarcodes, backfillDistributorSku } = await import("../lib/backfills");
      const bc = await backfillProductBarcodes(prisma);
      const sku = await backfillDistributorSku(prisma);
      await prisma.setting.create({ data: { key: "scan_issue_backfill_v1", value: new Date().toISOString() } });
      console.log(
        `deploy-db: scan-to-issue backfills — barcodes ${bc.created} created/${bc.skipped} existing of ${bc.scanned}; ` +
          `distributorSku ${sku.set} set/${sku.skipped} skipped/${sku.unmatched} unmatched.`,
      );
    });

    // Catalog CSV import — ADD/UPDATE products from the committed SiteOne line-item
    // files. Idempotent (a re-run is zero-change) + Setting-marker guarded so the
    // deploy applies it once; the admin "Import catalog CSV" button + the
    // scripts/import-catalog-csv.ts can re-run it anytime. Runs AFTER the SKU
    // backfill so item-# matching is maximally effective.
    await runStep("catalog CSV import", async () => {
      const marker = await prisma.setting.findUnique({ where: { key: "catalog_csv_import_v1" } });
      if (marker) {
        console.log("deploy-db: catalog CSV import already applied — left as-is.");
        return;
      }
      const { importCatalog } = await import("../lib/catalog-import");
      const r = await importCatalog(prisma, { apply: true });
      await prisma.setting.create({ data: { key: "catalog_csv_import_v1", value: new Date().toISOString() } });
      console.log(
        `deploy-db: catalog CSV import — ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged ` +
          `(${r.distinctItems} items; skipped ${r.skippedSurcharge} surcharge + ${r.skippedCredit} credit).`,
      );
    });

    // INVENTORY RESET (2026-10): clear the old Aug/Sep purchase + dispersal history
    // and rebuild from the owner-reconciled files in prisma/data/inventory-reset/,
    // so on-hand as of 9/30 (= start of 10/1) equals file 06 exactly. The WIPE runs
    // ONCE (marker), deleting historical invoices + non-checkout movements while
    // PRESERVING live scan-to-issue checkouts (checkoutLineId set) and products /
    // barcodes / warehouses / technicians. The IMPORT is idempotent (keyed by
    // externalRef) and re-asserts the correct data on every deploy. Ties to the
    // control totals in file 09; verify logs the per-row match vs file 06. NON-FATAL.
    await runStep("inventory reset 2026-10", async () => {
      const { runInventoryImport, verifyInventory } = await import("./inventory-reset");
      const wiped = await prisma.setting.findUnique({ where: { key: "inventory_reset_2026_10_wiped" } });
      if (!wiped) {
        // FK-safe order: movements (hold sourceInvoiceId) first, then invoices (lines cascade).
        const delMv = await prisma.stockMovement.deleteMany({ where: { checkoutLineId: null } });
        const delInv = await prisma.invoice.deleteMany({});
        await prisma.setting.create({ data: { key: "inventory_reset_2026_10_wiped", value: new Date().toISOString() } });
        console.log(`deploy-db: inventory reset WIPE — ${delMv.count} movements + ${delInv.count} invoices (live checkouts preserved).`);
      } else {
        console.log("deploy-db: inventory reset WIPE already applied — left as-is.");
      }
      const imp = await runInventoryImport(prisma, { apply: true });
      const v = await verifyInventory(prisma);
      await prisma.setting.upsert({
        where: { key: "inventory_reset_2026_10" },
        update: { value: new Date().toISOString() },
        create: { key: "inventory_reset_2026_10", value: new Date().toISOString() },
      });
      console.log(
        `deploy-db: inventory reset IMPORT — ${imp.opening} opening, ${imp.receipts} receipts, ${imp.issues} issues; ` +
          `catalog ${imp.catalog.matched} matched / ${imp.catalog.created} created; ` +
          `${imp.unmatchedTechs.length} unmatched techs, ${imp.unmatchedProducts.length} unmatched products; ` +
          `VERIFY vs file 06 — ${v.mismatches} mismatch(es), ${v.negatives} negatives.`,
      );
      if (v.mismatches > 0) console.error("deploy-db: inventory reset — ON-HAND MISMATCHES:", v.mismatchRows.join(" | "));
    });

    // CATALOG CLEANUP (one source of truth per product) — runs ONCE, guarded by
    // the `catalog_cleanup_v1` Setting. Canonicalizes each product from its invoice
    // history (fill-null SKU / vendor items / last cost), merges high-confidence
    // duplicates (shared SKU or identical normalized name) by repointing ALL history
    // onto one survivor so on-hand consolidates then deactivating the loser (never
    // hard-deletes a product that carries stock history), and flags off-catalog
    // products with no invoice backing into the Confirm Queue. Runs AFTER the
    // inventory reset so invoice lines + products exist to reconcile. NON-FATAL.
    await runStep("catalog cleanup (SSOT)", async () => {
      const marker = await prisma.setting.findUnique({ where: { key: "catalog_cleanup_v1" } });
      if (marker) {
        console.log("deploy-db: catalog cleanup already applied — left as-is.");
        return;
      }
      const { cleanupCatalog } = await import("./catalog-cleanup");
      const r = await cleanupCatalog(prisma, { apply: true });
      await prisma.setting.create({ data: { key: "catalog_cleanup_v1", value: new Date().toISOString() } });
      console.log(
        `deploy-db: catalog cleanup — scanned ${r.productsScanned}; canonicalized ${r.canonicalized.skuSet} SKU / ` +
          `${r.canonicalized.vendorItemsSet} vendor-items / ${r.canonicalized.costSet} cost; ` +
          `${r.clusters} duplicate cluster(s) → ${r.merged} merged (${r.hardDeleted} hard-deleted); ` +
          `${r.routedToQueue} off-catalog product(s) routed to the Confirm Queue.`,
      );
      if (r.mergeLog.length) for (const m of r.mergeLog) console.log("deploy-db: catalog cleanup merge —", m);
    });

    // ALIAS MERGE — collapse all-caps / long-form duplicate product rows into their
    // canonical catalog product using the curated PestPac alias map (safe 1:1
    // mappings only; the risky look-alikes go to the human Catalog Review screen).
    // Runs EVERY deploy (idempotent — once a variant is merged it's inactive and
    // won't re-match) so newly-imported duplicates keep getting folded in. NON-FATAL.
    await runStep("alias catalog merge", async () => {
      const { aliasMergeCatalog } = await import("./catalog-cleanup");
      const r = await aliasMergeCatalog(prisma, { apply: true });
      console.log(`deploy-db: alias catalog merge — ${r.merged} duplicate row(s) folded into their canonical product.`);
      if (r.log.length) for (const m of r.log) console.log("deploy-db: alias merge —", m);
    });

    // CANONICAL CATALOG RECONCILE — the owner-reconciled master
    // (prisma/data/inventory-reset/01_product_catalog.csv), keyed by SiteOne item
    // number, is the single approved source of truth. Ensures one survivor product
    // per master row (approved + confirmed, owner's name + item #s + cost), merges
    // every duplicate that resolves to the same item #/name/short-name/alias into it
    // (on-hand consolidates), and demotes leftover non-canonical rows to off-catalog
    // for review. Runs AFTER the inventory-reset import (so item-keyed rows exist) and
    // after the alias merge. Idempotent + non-fatal. This supersedes the earlier
    // conservative cleanup for consolidation — look-alikes with different item numbers
    // (the three Cross-Checks, each distinct-NPK fertilizer) correctly stay separate.
    await runStep("canonical catalog reconcile (SSOT)", async () => {
      const { reconcileCanonicalCatalog } = await import("./catalog-canonical");
      const r = await reconcileCanonicalCatalog(prisma, { apply: true });
      console.log(
        `deploy-db: canonical catalog — ${r.canonical} master products (${r.created} created), ` +
          `${r.merged} duplicate(s) merged into their canonical row, ${r.demoted} demoted to off-catalog.`,
      );
      if (r.log.length) for (const m of r.log) console.log("deploy-db: canonical merge —", m);
    });

    // Apply research-enriched product profiles (manufacturer / active ingredient /
    // EPA # / form / what-it's-used-for) onto the catalog. Fill-if-null; idempotent;
    // no-ops if prisma/data/product-research.json is absent. Runs after the canonical
    // reconcile so the survivor rows exist to enrich. NON-FATAL.
    await runStep("product research enrichment", async () => {
      const { applyProductResearch } = await import("./apply-product-research");
      const r = await applyProductResearch(prisma);
      console.log(`deploy-db: product research — matched ${r.matched}, updated ${r.updated}${r.unmatched.length ? `, unmatched: ${r.unmatched.length}` : ""}.`);
    });

    // PHASE 4 — clear existing product-linked photos so the fresh scanning pass
    // starts clean (owner authorized; photos will be re-captured + reassigned to
    // the SSOT product list). Runs ONCE, guarded by `product_photos_cleared_v1`.
    // Nulls CheckoutLine.photoUrl (the current product-linked photos); the checkout
    // records themselves are preserved. NON-FATAL.
    await runStep("clear product photos", async () => {
      const marker = await prisma.setting.findUnique({ where: { key: "product_photos_cleared_v1" } });
      if (marker) {
        console.log("deploy-db: product photos already cleared — left as-is.");
        return;
      }
      const { clearProductPhotos } = await import("./catalog-cleanup");
      const r = await clearProductPhotos(prisma, { apply: true });
      await prisma.setting.create({ data: { key: "product_photos_cleared_v1", value: new Date().toISOString() } });
      console.log(`deploy-db: cleared ${r.cleared} product-linked photo reference(s).`);
    });

    // Load each employee's birthday from the HR "Employee Listings" export
    // (prisma/data/employee-birthdays.json) onto their profile. Matches active
    // employees by exact name / formal-name alias (no fuzzy guessing); unmatched
    // rows are reported and surfaced at /api/management/birthdays/diagnostics.
    // Applies ONCE (Setting marker employee_birthdays:v1 — bump to re-run after a
    // data correction) so it never clobbers later manual HR edits. Non-fatal.
    await runStep("employee birthdays backfill", async () => {
      const markerKey = "employee_birthdays:v1";
      const marker = await prisma.setting.findUnique({ where: { key: markerKey } }).catch(() => null);
      if (marker) {
        console.log("deploy-db: employee birthdays already applied (v1).");
        return;
      }
      const { backfillBirthdays } = await import("./backfill-birthdays");
      const r = await backfillBirthdays(prisma, { apply: true });
      await prisma.setting.upsert({ where: { key: markerKey }, update: { value: new Date().toISOString() }, create: { key: markerKey, value: new Date().toISOString() } });
      console.log(
        `deploy-db: employee birthdays — matched ${r.matched.length}/${r.total}, unmatched ${r.unmatched.length}` +
          (r.unmatched.length ? `: ${r.unmatched.map((u) => u.sheet).join(", ")}` : ""),
      );
    });

    await runStep("password policy rollout", async () => {
      const { seedPasswordPolicy } = await import("../prisma/seed-pw-policy");
      const pw = await seedPasswordPolicy(prisma);
      console.log("deploy-db: password policy —", JSON.stringify(pw));
    });

    // PTO-for-all: every active login must be linked to an Employee (PTO
    // self-service keys off User.employeeId). Idempotent — links or creates each run.
    await runStep("link logins to employees (PTO-for-all)", async () => {
      const { ensureLoginsLinked } = await import("../prisma/link-logins");
      const r = await ensureLoginsLinked(prisma);
      console.log("deploy-db: login→employee link —", JSON.stringify(r));
    });

    // Leadership super-admins → canonical employee profile. The "super admins
    // ensure" step above sets their role/accessLevel/branch but NEVER employeeId,
    // and Chris's split identity ("Christopher Slade" census row vs the email-less
    // "Chris Slade" org-chart row) can leave c.slade@ unlinked — so PTO, the
    // Employee Hub profile, and certifications show "no profile linked" for the COO.
    // This links each leadership login to its profile by work email first (then by
    // name), creating one only if genuinely missing. Idempotent + non-destructive;
    // runs LAST so it corrects whatever the generic linkers left. NON-FATAL.
    await runStep("link leadership logins to employees", async () => {
      const { ensureLeadershipLinked } = await import("../prisma/link-leadership");
      const r = await ensureLeadershipLinked(prisma);
      console.log("deploy-db: leadership login→employee link —", JSON.stringify(r));
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("deploy-db failed:", e);
  // Only the schema push is allowed to fail the build. If the schema is already
  // in place, a later seed error must NOT block the deploy — the app ships with
  // the latest code and the (idempotent) seed retries on the next deploy.
  if (!schemaReady) process.exit(1);
  console.error(
    "deploy-db: schema is in place but a post-push seed threw — continuing so the app still deploys. The seed will retry next deploy.",
  );
  process.exit(0);
});
