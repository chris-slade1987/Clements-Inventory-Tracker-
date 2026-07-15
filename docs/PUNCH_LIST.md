# Clements Command & Control — Phase 1 Punch List

Status of the "phase 1 wiring" build: an audit of remaining work — dormant plumbing,
placeholders, stubs, incomplete flows, and integration gaps. Read-only analysis; nothing
below has been changed. Each item cites the file(s) involved.

---

## Top 5 highest-leverage items

1. **No scheduler fires the daily reminder jobs.** `POST /api/training/remind` and
   `POST /api/personnel/sign/remind` are built and idempotent, but there is no
   `vercel.json` cron and no `.github/workflows/`. Nothing calls them, so training and
   signature reminders never send on their own. (Add a cron hitting them with `CRON_SECRET`.)
2. **Email is effectively off in every environment.** `lib/email.ts` no-ops unless
   `RESEND_API_KEY` is set, and that var (plus `EMAIL_FROM`, `APP_URL`, `CRON_SECRET`, the
   HR/escalation addresses) is not documented in `.env.example` or `DEPLOY.md`. Every send
   currently logs `skipped_no_provider`. All notification flows are dark until this is wired.
3. **Management (executive) center has no role/branch guard.** There is no
   `app/(app)/management/layout.tsx`; each page calls `requireUser()` only. Any logged-in
   manager — or an `employee` typing the URL — can open `/management/board` company financials
   (full P&L / balance sheet), `/management/sales`, and `/management/people` HR files. The
   board page never scopes by branch.
4. **Three core placeholders block scorecard completion & HR.** Quality Control form
   (`/my-branch/qc`), the Technician Annual Review (`/management/people/[id]`), and there is
   **no HR document hub** (handbook / SOPs / policies) at all. QC is a weighted scorecard
   metric (`qc_reports`, 5%) with no data source, so that line can never auto-satisfy.
5. **Budgets are hardcoded placeholders.** `lib/budgets.ts` ships stand-in monthly
   purchasing budgets ("Chris will provide real figures"), surfaced with a literal
   `placeholder` badge on the dashboard. No editable settings UI exists to replace them.

---

## Dormant plumbing (built but not firing)

- [ ] **No cron/scheduler wired.** No `vercel.json`, no `.github/workflows/`. The two daily
  reminder endpoints below run only if hit manually by an admin or an external scheduler with
  `CRON_SECRET`. — repo root; `app/api/training/remind/route.ts:14`, `app/api/personnel/sign/remind/route.ts:15`
- [ ] **Training reminders never auto-send.** `app/api/training/remind/route.ts` emails
  employees with incomplete assignments (throttled per day) but is untriggered.
- [ ] **Signature reminders never auto-send.** `app/api/personnel/sign/remind/route.ts`
  chases outstanding e-sign requests daily but is untriggered.
- [ ] **Email provider unconfigured & undocumented.** `lib/email.ts:30` requires
  `RESEND_API_KEY`; without it every send returns `skipped_no_provider` (logged to `EmailLog`).
  `RESEND_API_KEY`, `EMAIL_FROM` (`lib/email.ts:10`) are absent from `.env.example` and `DEPLOY.md`.
- [ ] **`APP_URL` / `NEXT_PUBLIC_APP_URL` not documented.** Used to build absolute links in
  every outbound email; if unset, links render as relative/broken. — `app/api/training/remind/route.ts:9`,
  `app/api/personnel/sign/remind/route.ts:10`, `app/api/personnel/sign/request/route.ts:11`,
  `app/api/management/course/manage/route.ts:10`, `app/api/personnel/record/route.ts:16`
- [ ] **HR/escalation addresses env-only with hardcoded fallbacks.** `FIELD_OPS_EMAIL`,
  `COO_EMAIL`, `OWNER_EMAIL`, `HR_EMAIL` fall back to literal `@clementspestcontrol.com`
  addresses; not in `.env.example`. HR email also resolves via a `Setting` row `hr_email` that
  has no admin UI to set. — `lib/personnel.ts:151-171`
- [x] **Durable file storage — DONE (Vercel Blob).** All uploads (vehicle documents, personnel
  attachments, separation docs, training materials, check-in & maintenance invoices) route through
  `lib/storage.ts`; production uses Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, dev falls back to
  local `public/uploads`. Set the token in Vercel to persist files.
- [ ] **Google Drive redundancy / mirror (down the road).** Clements runs Google Workspace with Drive
  storage, so mirror every uploaded document into a Shared Drive as a backup + human-browsable copy
  (e.g. `/Fleet/<unit>/`, `/HR/<employee>/`). Layer a Drive writer onto `lib/storage.ts` (dual-write to
  Blob + Drive; store both refs on the record) via a Workspace service account / domain-wide delegation,
  or the existing Google MCP connector. Blob stays the app's primary (fast, signed access); Drive is the
  redundant of-record copy staff already know how to navigate. Also lets Finance/HR retention live where
  it already does. — pairs with the access-control + `/api/file/[id]` proxy work.
- [ ] **Gate sensitive document downloads.** Stored URLs are public-but-unguessable; vehicle-insurance
  and HR/separation docs can carry PII (driver's-license #s). Add an authenticated `/api/file/[id]`
  proxy and flip Blob `access` to private. — `lib/storage.ts`

## Placeholders & missing forms

- [ ] **Quality Control form — "Coming soon" stub.** `app/(app)/my-branch/qc/page.tsx:22` is a
  static card; no form, no model, no API. It is a live scorecard metric (`qc_reports`, weight 5,
  `type: "compliance"`) that can never auto-satisfy without a data source. — `lib/scorecard.ts:35`
- [ ] **Technician Annual Review — "Coming soon" stub.** `app/(app)/management/people/[id]/page.tsx:202-213`.
  No review model/form; intended to aggregate inspection + ride-along scores like the manager scorecard.
- [ ] **HR document hub does not exist.** No handbook / SOP / policy library anywhere.
  `/me/library` (`app/(app)/me/library/page.tsx`) is training lessons only. ROADMAP calls for
  "doc storage" under HR (`ROADMAP.md:29`) — no model, page, or upload.
- [ ] **Dashboard budget is a literal placeholder.** `app/(app)/dashboard/page.tsx:80` renders a
  `placeholder` badge; values come from hardcoded `lib/budgets.ts:1-9`. No editable-settings UI.
- [ ] **Scorecard `unserviced_pct` metric is manual-only.** `lib/scorecard.ts:28` (`type: "manual"`)
  with no data source — reviewer must type it every quarter.
- [ ] **No employee rebuttal / written-response upload.** `lib/personnel.ts:136` promises a written
  rebuttal "will be retained with this record," but there is no upload path for it (only the
  original write-up attachment via `PersonnelRecord.attachmentFile`).
- [ ] **PIP (performance improvement plan) not tracked.** `category` on `PersonnelRecord`
  contemplates `pip` (`prisma/schema.prisma:482`) but no form field or workflow exists.
- [ ] **OSHA 300 log & workers'-comp claim tracking not built.** The accident form captures
  `oshaRecordable` / `workersComp` yes/no flags in `details` JSON (`lib/personnel.ts:142-147`), but
  there is no OSHA 300 rollup log or claim-status tracking view.
- [ ] **`PersonnelRecord.acknowledgedAt`** exists for a future employee sign-off but is unused —
  `prisma/schema.prisma:493`.

## Access control

- [ ] **No management-center layout guard.** No `app/(app)/management/layout.tsx`; contrast with
  `app/(app)/manage/layout.tsx` (admin-gated). Executive pages self-gate with `requireUser()` only:
  `board/page.tsx:30`, `sales/page.tsx:27`, `scorecards/page.tsx:15`, `people/page.tsx:19`,
  `management/page.tsx:34`, `audits/page.tsx:20`.
- [ ] **Branch managers see company-wide financials.** `/management/board` shows full company
  P&L / balance sheet with no branch scoping and no admin/exec gate — `app/(app)/management/board/page.tsx`.
- [ ] **Employees (`role: "employee"`) are not blocked from manager/exec/inventory routes.** The
  app group layout only calls `requireUser()` (`app/(app)/layout.tsx:11`); `homePath` sends them to
  `/me` and the shell hides the switcher (`components/AppShell.tsx:93`), but there is no server-side
  redirect — a direct URL to `/dashboard`, `/management/board`, or `/my-branch` loads. Only
  `/me/training/[id]` checks employee ownership (`app/(app)/me/training/[id]/page.tsx:16`).
- [ ] **Per-record HR visibility gap.** `app/(app)/management/people/[id]/page.tsx` uses
  `requireUser()` with `canEdit = admin` but does **not** branch-check — a branch manager can open any
  employee's HR file (write-ups, accidents) by ID. Compare `my-branch/team/[id]/page.tsx:27`, which
  redirects when `branchLocked && employee.branch !== user.branch`.
- [ ] **CSV export inherits the same broad access.** `app/api/reports/export/route.ts:18` allows any
  logged-in user; no branch scoping on the export.
- [ ] **`branchLocked` scoping is per-page, not enforced centrally.** Each page must remember to call
  `scopedBranch`; a page that forgets leaks cross-branch data (see board above). Consider a shared guard.

## Data model / identity duplication

- [ ] **Three overlapping person models: `User`, `Employee`, `Technician`.** `User` = app logins,
  `Employee` = HR/inspection profiles, `Technician` = stock check-out recipients — no enforced link
  between `Technician` and `Employee`. — `prisma/schema.prisma:34,51,447`
- [ ] **Name-matching is heuristic and lossy.** `lib/people.ts:21 matchEmployeeByName` matches on
  first name + last initial; ambiguous names silently return `null` (no match, no warning). Used for
  vehicle `assignedTo` → employee and inspection driver tagging.
- [ ] **`VehicleInspection` / `AuditRideAlong` / `TechProduction` store free-text names**
  (`technicianName`, `techName`) alongside optional `employeeId`; unmatched names never accrue to a
  profile. — `prisma/schema.prisma:293,405,658`
- [ ] **`User.employeeId` is optional & unenforced.** Employee logins depend on it being set, but no
  reconciliation UI links a `User` to its `Employee`; `/me/library` shows "No profile linked" when
  absent (`app/(app)/me/library/page.tsx:10`).
- [ ] **Branch key `naples` appears in schema/enums but there are only three warehouses** (Vero,
  Stuart, Orlando per CLAUDE.md). Confirm whether Naples is real; `lib/budgets.ts` includes a Naples
  budget. Possible dead/aspirational branch. — `prisma/schema.prisma:58,244,315`

## Reporting & output

- [ ] **Only one export exists — inventory CSV.** `app/api/reports/export/route.ts` (wired from the
  Reports page `FilterBar exportBase`). No exports for management/board, scorecards, audits, people,
  fleet, or training.
- [ ] **No PDF generation anywhere.** Signed personnel records, write-ups, accident reports, audits,
  and scorecards cannot be rendered/downloaded as PDF for the personnel file — despite E-SIGN language
  implying a retainable signed document (`lib/personnel.ts`, `PersonnelSignature` model).
- [ ] **No company-wide compliance rollup dashboard.** Compliance (inspections, warehouse, training)
  is computed per branch/quarter for the scorecard (`lib/scorecard.ts:131`) but there is no
  cross-branch executive rollup view. ROADMAP wants a "consolidated home" (`ROADMAP.md:66`).
- [ ] **No "board packet" / "manager packet" export** from live data — called out as a goal in
  `ROADMAP.md:68`, not built.
- [ ] **`EmailLog` has no admin viewer.** Every send/skip is logged (`prisma/schema.prisma:601`) but
  no page surfaces it, so "email is silently off" is invisible to admins.

## Per-feature gaps

- [ ] **Inventory (Check-In / Check-Out / Reconcile / Reports / Alerts):** the most complete center.
  Gaps: invoice file not durably stored (above); alert-run endpoint (`app/api/alerts/run/route.ts`)
  presence — verify it's triggered/scheduled or manual-only.
- [ ] **Management / Board:** depends entirely on uploaded MBR data; empty state until an MBR is
  uploaded (`app/(app)/management/board/page.tsx:33`). No branch scoping/guard (above).
- [ ] **Sales & Attrition:** same MBR dependency and empty state (`app/(app)/management/sales/page.tsx:31`).
  Lead-level close-rate data (`LeadSource.leads/won`) is "fed separately" and not ingested
  (`prisma/schema.prisma:274`); no Sales Center import exists.
- [ ] **Scorecards:** `qc_reports` and `unserviced_pct` metrics have no data source (above); the rest
  auto-compute or are reviewer-set. Otherwise wired.
- [ ] **Branch Audits:** prep checklist, audit form, and follow-ups are built and admin-gated
  (`audits/edit`, `audits/prep` require admin). Follow-ups feed manager reminders (`lib/reminders.ts:130`).
- [ ] **Fleet / Vehicle Inspections / Service:** vehicle registry, monthly inspection, and service
  logging are wired; service logging is admin-only (`fleet/service/page.tsx:11`). GPS/telematics
  fields exist on `Vehicle` but no integration (`ROADMAP.md` Phase 3).
- [ ] **Warehouse Inspection:** monthly form wired and feeds scorecard compliance
  (`my-branch/warehouse/inspect`, `lib/warehouse.ts`).
- [ ] **Training / LMS:** course creation, assignment, quiz-taking, and completion→scorecard are
  wired; assignment/reminder emails depend on the dormant email + cron plumbing (above).
- [ ] **People / HR:** profiles, records (write-up/note/recognition/accident), and e-sign are built.
  Missing: annual review, HR doc hub, rebuttal upload, PIP, OSHA/WC tracking (above); no branch guard
  on the detail page (above).
- [ ] **Team / e-sign:** in-person and remote (tokenized link) signing work
  (`app/sign/[token]`, `app/api/personnel/sign/*`); remote reminders are dormant (above).

## Notifications (should notify but don't yet)

- [ ] **Training assignment/reminder emails** — assignment notice + daily reminders defined
  (`TrainingAssignment.notifiedAt/lastReminderAt`) but gated on email provider + cron.
- [ ] **Personnel record → HR/leadership escalation** — `notifyList` (`lib/personnel.ts:158`) targets
  HR + Field Ops + COO + Owner on write-ups/accidents; sends only when `RESEND_API_KEY` is set.
- [ ] **Signature-request emails and daily chase** — depend on email + cron.
- [ ] **Inspection-score email to technician** — `Employee.email` is "filled later"
  (`prisma/schema.prisma:450`); most profiles lack an address, so scores won't email even with a provider.
- [ ] **No in-app notification center** — reminders surface only on `/my-branch` when a manager logs
  in (`lib/reminders.ts`); nothing pushes/badges.

## Nice-to-haves / UX & mobile debt

- [ ] Wide data tables (reports on-hand-by-product, board financials, people/training tables) rely on
  `overflow-x-auto`; usable but cramped on phones despite the mobile-first mandate (CLAUDE.md).
- [ ] Demo password `clements123` shipped in `DEPLOY.md`; change-password flow is a manual SQL step,
  no in-app UI.
- [ ] Seed data is a demo cohort (e.g. training assigned to "every active Vero Beach employee",
  `prisma/seed-training.ts:33`); board/sales/scorecards are empty until real MBRs are uploaded, while
  fleet/people/training show seeded sample data — mixed demo vs. real state.
- [ ] No admin UI for `Setting` rows (price-increase threshold, `hr_email`); only `app/api/settings`
  exists for some values — verify coverage.
</content>
</invoke>
