import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

// Seed the document center from the Markdown sources in prisma/data. Idempotent
// upsert by slug: refreshes title/summary/body/effective/audience/kind without
// touching acknowledgments (append-only). The version is bumped ONLY when the
// `version` declared in DOCS below is raised deliberately — the seed moves the
// stored version forward to match (never downgrades), so an ordinary content
// tweak keeps the version while a real new edition re-prompts acknowledgers.

type DocSeed = {
  slug: string;
  title: string;
  kind: string; // "handbook" | "manual"
  audience: string; // "all" | "manager"
  file: string;
  summary: string;
  effective: string;
  // The intended published version. Bumped deliberately when the content
  // change is a new *published* version (re-prompts acknowledgers). The seed
  // only ever moves the stored version FORWARD (never downgrades), and never
  // touches the append-only acknowledgments.
  version: number;
};

const DOCS: DocSeed[] = [
  {
    slug: "employee-handbook",
    title: "Employee Handbook",
    kind: "handbook",
    audience: "all",
    file: "handbook.md",
    summary: "Clements Pest Control's employee handbook — policies, benefits, and expectations. Requires a typed-signature acknowledgment.",
    effective: "Version 2 · Effective July 21, 2026",
    // v2: PTO-request submission mechanic corrected to the Clements portal
    // (was "via Paychex Flex"); policy entitlements unchanged. Employees who
    // acknowledged v1 are re-prompted to acknowledge v2.
    version: 2,
  },
  {
    slug: "manager-manual",
    title: "Manager Operating Manual",
    kind: "manual",
    audience: "manager",
    file: "manager-manual.md",
    summary: "Manager-only operating reference, reconciled against what the Clements Command & Control portal does today.",
    effective: "Version 40 · Last updated October 24, 2026",
    // v40: Weather Ops added — a new My Branch tool (and dashboard tile) that turns
    // the NWS/NHC forecast into a Green/Yellow/Red ops read for routing & service
    // completion, with a rules-computed risk level + an AI ops briefing. Managers see
    // their territory; leadership sees all four. New manual "Weather Ops" subsection.
    // Re-prompts prior acknowledgers.
    // v39: Weekly oversight consolidated into BRANCH COMMAND. §2 Weekly
    // Responsibilities now describes the weekly cockpit (fed scoreboard across the
    // seven domains, AI-flagged items you must explain, per-technician review, and
    // a sign-off you cannot complete until every flag is answered / tech reviewed /
    // item checked, due every Friday). Branch Command replaces the old weekly
    // checklist (that page now redirects there); a missed Friday is still a
    // CEO/HR-clearable miss. Re-prompts prior acknowledgers.
    // v38: Vehicle Inspection Form overhaul. Mileage is now REQUIRED; Section B is
    // next-oil-change-only (next-due mileage and/or month from the sticker, at least
    // one required) and drives an oil-change-due alert (within 500 mi / ~1 month);
    // FOUR photos are now REQUIRED (exterior front, truck bed, interior front,
    // interior back) and ride on the filed record + the emailed copy; and only
    // technician / service-advisor trucks are listed for inspection (execs,
    // managers, spares, and trailers are excluded). Re-prompts prior acknowledgers.
    // v37: Catalog management is now SUPER-ADMIN-ONLY (Chris, Julie, April) — the
    // Products catalog, Catalog Review, Stock Import, and product photos are no
    // longer manager/admin/HR editable; everyone else uses check-out identify and
    // the "Request new product" flow. That request flow now takes up to 3 photos
    // (product/barcode/label) with AI autofill + an on-hand count; on approval the
    // product is cataloged with the reviewed fields, its photos are attached, and
    // the on-hand is posted as an adjustment. Reference photos now feed check-out
    // identify. Re-prompts prior acknowledgers.
    // v36: Org Chart — super admins (Chris/Julie/April) get "Edit structure" to
    // move a person to a new supervisor (search → confirm pop-up → save), which
    // updates their profile's Reporting line (supervisor + team); unassigned people
    // are flagged "No supervisor"; the chart stretches full-width.
    // v35: Org Chart & Directory reconciled — horizontal family-tree layout,
    // collapsed cards that Expand to show details (incl. the new corporate role:
    // what they do + when to go to them for help), and card editing opened to every
    // staff member EXCEPT field technicians (was HR/leadership + branch managers).
    // v34: Catalog Review (Duplicates / Off-catalog / New products tabs; merge
    // consolidates on-hand onto one row) + Products defaults to the Approved catalog.
    // v33: added the "Photo Catalog" section — human-in-the-loop capture (review
    // before submit), AI suggests but never auto-assigns, choose-other-product
    // override, discard, and a re-assignable/deletable gallery.
    // v32: Check-OUT reconciled to the "properly cataloged" hard stop (nothing
    // dispenses unless it's on the approved catalog + confirmed + active) and the new
    // self-service "Requesting a new product" flow (sample/off-catalog → super-admin
    // approval → requester notified). Re-prompts prior acknowledgers.
    // v31: Termination Policy now notes offboarding auto-sends a service coverage-gap
    // alert (supervisor + HR + CSR Coordinator) flagging any service a departure would
    // leave with no/one backup in the branch, so interim coverage is arranged.
    // v30: reconciled the Hiring/Onboarding new-hire-review passage — each party must
    // answer their own questions before signing; the new hire can fill + e-sign via a
    // secure emailed link; and HR reopening a review now auto-re-invites both the
    // reviewer (in-app + email) and the new hire (fresh emailed token link) to re-sign.
    // v29: added the Org Chart & Directory section — the universal company Org Chart
    // (square tiles nested under their manager, search by name/route/service/branch,
    // collapsible teams), the scoped tile editor (approved services, scheduling
    // rules, route number — HR/leadership anyone, branch managers own branch), and
    // the attributed Employee Notes log on the profile. CanopyOS Org Chart Round 2.
    // v28: added the Groundwork section — the universal work home (My Work To-Dos,
    // Huddles with agenda templates + live notes + real-time follow-ups, The
    // Greenhouse for someday ideas, and Projects), plus how calendar sync shows
    // live Google free/busy vs. the .ics fallback. CanopyOS Round 2-C UI.
    // v27: added the Standard Operating Procedures (SOPs) section — the checklist
    // engine generalized into a reusable, guided, signed SOP runner (My Branch →
    // SOPs) with assigned "Due now" items + run-on-demand, and the leadership SOP
    // Library (publish/version/assign). CanopyOS vision Theme 2.
    // v26: reconciled the Inventory sections for the 2026-10-17 audit fixes —
    // Check-IN now has a searchable product picker + case→unit helper, blocks/counts
    // unmatched lines before Confirm, guards against duplicate invoices, and offers a
    // receipt-level Undo (15-min window, reverses as adjustments); Stock Count shows
    // the whole shelf (paged, progress tally, scan-to-jump, unsaved-count warning);
    // Reconcile defaults a new adjustment to your own branch and shows current +
    // resulting on-hand in every dialog.
    // v26: reconciled the People/HR self-service + lifecycle-notification pass —
    // PTO request form now shows remaining balance, a non-blocking over-balance
    // warning, and a routed-to (supervisor vs Director of HR) confirmation, and
    // both request and decision are notified by in-app Inbox as well as email;
    // onboarding submit now notifies HR (Inbox + email), approve-&-convert
    // auto-assigns the onboarding course set, a one-click "Grant login & send
    // welcome" was added, placeholder packet legal content is flagged; and the
    // Handbook acknowledgments roster gained Email reminder / Copy link / Remind
    // all outstanding (in-app nudge for logged-in employees, emailed link otherwise).
    // v25: reconciled the Sales Team section for the motivation-kit v2 goal-sheet
    // rework — the My Sales Goals pace speedometer (projected month-end close vs
    // goal, colored by REAL on-track pace so dragging the goal no longer fakes the
    // color; neutral "Awaiting results" until closed $ flow), close-rate rings, and
    // the Sales Director's non-destructive "propose a goal" / advisor "accept"
    // co-goal-setting with the Advisor-set / Director-proposed / Agreed status chip.
    // v23: added the Certifications subsection — the read-only Management →
    // Certifications console (admin / HR / senior leadership) for browsing the
    // internal certification program's structure (certifications, modules,
    // prerequisites, pathways). Browse-only for now; no enrollment, progress,
    // sign-off, or module content, and no employee data.
    // v22: added the Inventory › Reports & analysis subsection — the tabbed
    // Reports hub (Overview / Purchases / Dispersals / Spend / On-hand), each tab's
    // filters + date presets + per-view CSV export, and branch scoping (branch-locked
    // managers see only their branch; admins/senior leadership see all).
    // v21: consolidated the Inventory Check-OUT section to the single smart
    // Check-Out screen — the separate "Scan Checkout" screen was retired and now
    // redirects to Check-Out. The one Check-Out is scan-powered (scan barcode /
    // shelf QR, unknown-barcode "which product is this?" linker, AI photo
    // fallback), with the cart, optional signature, 15-minute undo, History, and
    // the over-dispense + unconfirmed hard stops (never-counted products exempt
    // from the negative-stock block); escalation on the over-dispense stop kept.
    // v20: documented the employee Birthday field now being Month/Day/Year with an
    // HR-only birth year (shown only on the HR profile, never on the team view,
    // bulletin, or any celebration), and the day-of Buzz celebration — a profile
    // banner + org/roster markers, an auto-posted bulletin shoutout, and a
    // supervisor heads-up in Messages/Inbox — all timed to Eastern Time and firing
    // once per person per year.
    // v19: added the Inventory › Scan Checkout subsection — the phone scan-to-issue
    // flow (pick tech → scan barcode/shelf QR or AI photo → confirm → qty → cart →
    // review + optional signature → submit), the 15-minute undo / admin void, the
    // History screen, and the Stock / Stock Count screens (physical count writes
    // adjustments and lifts the not-yet-counted 40-unit cap). Same core on-hand rule
    // and the same over-dispense + unconfirmed hard stops as Check-Out.
    // v18: Documents consolidation — Document Intake is now the "Add" tab of a
    // unified Documents page (Add = AI intake, Filed = vehicle-doc library); the
    // standalone Document Center upload was removed and /management/intake redirects.
    // v17: reconciled the Inventory Check-IN + Document Intake sections — the
    // Check-In review screen now has an AI chat that revises the draft invoice in
    // plain English before Confirm, and Document Intake can route a distributor
    // invoice to "Inventory check-in" (staged for review on the Check-In screen).
    // Neither posts stock on its own; Confirm remains the only path that does.
    // v16: reconciled the Sales Team section for the SmarterLaunch connector — the
    // lead heat map and lead-source board switch from sample data to the live
    // SmarterLaunch feed (signed webhook + nightly catch-up) once it's connected,
    // and the "Load sample data" control is hidden at that point.
    // v15: added the Branch Manager and Corporate Employee new-hire review forms,
    // with Corporate Employee as the catch-all for any role that isn't Technician,
    // Service Advisor, CSR, or Branch Manager.
    // v14: reconciled the Hiring / Onboarding section for role-specific new-hire
    // reviews (Technician / Service Advisor / CSR forms, auto-selected by access
    // level, HR-overridable) and supervisor auto-assignment (the review is
    // auto-assigned to the new hire's direct supervisor when it comes due).
    // v13: documented the Sales Team lead heat map (geographic lead density
    // color-coded by funnel stage, with the This month/Last month/YTD/custom
    // date-range control and stage filter — company-wide for the director,
    // personal for the advisor) and the lead-source performance board (per-channel
    // volume + conversion and the company-provided vs. self-generated split), both
    // with AI insight and SmarterLaunch-ready / sample-data-until-cutover behavior.
    // v12: added the Document Intake section — the universal drop-any-file intake
    // with a Claude chat that proposes where each document routes (vehicle doc,
    // branch doc, MBR hand-off, or filed-with-tags) and files it only on the
    // manager's approval.
    // v24: replaced the read-only "Certifications" section with the full
    // "Training Center" section — HR-driven Program → Module → Course assignment
    // (Assign/Courses/Certifications/Reports tabs), automatic credit, the
    // Field-Core prerequisite guard, one-module-per-month pacing, advancement
    // stepping, and certification award gating on the approved field sign-off.
    version: 40,
    // v11: expanded the Sales Team section to document the per-advisor visual
    // funnel (Leads → Proposals → Closed $ with per-stage goals, pace markers,
    // and plain-English leak diagnosis), the director leaderboard / most-improved
    // / funnel-health matrix / inline funnel entry, the AI coach + team briefing,
    // and the load/clear-sample-data controls used until SmarterLaunch is connected.
    // v10: documented managing people from the org chart — setting a person's
    // manager (reporting line), assigning an access level, and GRANTING A LOGIN to
    // a newly added employee who has none ("Grant login" on their org-chart card,
    // creating their account at their work email + the shared default password).
    // v9: documented the company-wide physical-count reconciliation under
    // Inventory › Month-end physical reconciliation — on-hand at every branch is
    // trued up to a dated physical count via audited adjustment movements (the
    // first, dated July 27, 2026, was loaded this way).
    // v8: documented the editable Hiring Template Library in Hiring / Onboarding
    // — HR/admin-built interview + HR-screening templates (off-the-shelf bank,
    // custom questions, and AI-assisted drafting), role/worker-type assignment,
    // per-job template assignment, and the supervisor-fills-only access rule.
    // v7: documented the full applicant pipeline in Hiring / Onboarding — the
    // stage-grouped job container (Applied → Screening → Interview → Ranked →
    // Selected → Pre-hire + retained Excluded), HR shortlist + Google-native
    // screening booking link, interview handoff (assign supervisor + deadline +
    // standardized questionnaire), stage-specific exclusion (No-show etc.),
    // forced ranking → 48h selection window → warm-rejection of runner-ups
    // (keep-warm) → Move to pre-hire boundary, and the Reactivate archive path.
    // v6: documented the public job-application "front door" in Hiring /
    // Onboarding — per-job public apply links (Indeed + company website, source
    // tracked by channel), the branded no-login apply page, the public /careers
    // listing, the automatic applicant confirmation email, and the HR/supervisor
    // new-applicant notification. Candidates now auto-populate the pipeline.
    // v5: expanded the GPS / Live Fleet Tracking subsection with the GPS
    // Analytics dashboard (fleet status, utilization, exception tiles,
    // per-vehicle rollup, AI insights panel) and the dedicated GPS Alerts
    // section (auto-detected speeding/idle/after-hours/offline/out-of-area +
    // optional AI patterns; ack/dismiss; separate from inventory Alerts).
    // v4: added the GPS / Live Fleet Tracking subsection under Company Vehicles
    // (portal Live Map + per-vehicle location/trips from Verizon Connect Reveal;
    // near-real-time, credential-gated with a sample-data fallback).
    // v3: added the Attendance / Call-Outs tracking flow to the Technician
    // Absence Policy (call-outs logged on the employee profile; >2-day illness
    // medical-note rule; physical-injury → accident-report link).
    // v2: retired the last paper-form procedures (routine vehicle/equipment
    // maintenance logs, vehicle inspection form) in favor of the Fleet
    // "Log Service" + digital inspection workflows; escalation contacts fixed.
  },
];

function readDoc(file: string): string {
  return readFileSync(join(process.cwd(), "prisma", "data", file), "utf8");
}

export async function seedDocuments(prisma: PrismaClient) {
  const results: { slug: string; version: number; length: number; created: boolean }[] = [];
  for (const d of DOCS) {
    const body = readDoc(d.file);
    const existing = await prisma.policyDocument.findUnique({ where: { slug: d.slug } });
    if (!existing) {
      const created = await prisma.policyDocument.create({
        data: {
          slug: d.slug,
          title: d.title,
          kind: d.kind,
          audience: d.audience,
          version: d.version,
          summary: d.summary,
          body,
          effective: d.effective,
          published: true,
        },
      });
      results.push({ slug: d.slug, version: created.version, length: body.length, created: true });
    } else {
      // Refresh content and move the version FORWARD to the declared version
      // when it's been deliberately bumped in DOCS. Never downgrades, and never
      // touches the append-only acknowledgments (a bump simply re-prompts).
      const nextVersion = Math.max(existing.version, d.version);
      const updated = await prisma.policyDocument.update({
        where: { slug: d.slug },
        data: {
          title: d.title,
          kind: d.kind,
          audience: d.audience,
          version: nextVersion,
          summary: d.summary,
          body,
          effective: d.effective,
          published: true,
        },
      });
      results.push({ slug: d.slug, version: updated.version, length: body.length, created: false });
    }
  }
  return results;
}

// Standalone sanity run: `tsx prisma/seed-documents.ts`
if (process.argv[1] && process.argv[1].endsWith("seed-documents.ts")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const beforeAcks = await prisma.documentAcknowledgment.count();
      const res = await seedDocuments(prisma);
      const afterAcks = await prisma.documentAcknowledgment.count();
      for (const r of res) {
        const toc = await prisma.policyDocument.findUnique({ where: { slug: r.slug }, select: { body: true } });
        const tocCount = (toc?.body.match(/^- \[.+\]\(#.+\)$/gm) ?? []).length;
        console.log(
          `seed-documents: ${r.slug} — v${r.version}, body ${r.length} chars, ${tocCount} TOC entries (${r.created ? "created" : "updated"}).`,
        );
      }
      console.log(`seed-documents: acknowledgments ${beforeAcks} -> ${afterAcks} ${afterAcks === beforeAcks ? "UNCHANGED" : "CHANGED!"}.`);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
