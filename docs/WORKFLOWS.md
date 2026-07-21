# Clements Command & Control — Workflow Registry

Durable, code-derived inventory of every workflow the portal implements, mapped to the
Manager Operating Manual (`prisma/data/manager-manual.md`) and Employee Handbook
(`prisma/data/handbook.md`) sections that describe it, with a reconciliation status.

Canonical steps below are derived by **reading the code** (routes under `app/(app)/**`, API
handlers under `app/api/**`, business logic in `lib/**`, and `prisma/schema.prisma`). Anything
uncertain in code is marked **verify** rather than asserted.

**Status legend:** ✅ aligned · ⚠️ stale (wording drifted) · ❌ contradicts (doc describes a
now-wrong process) · 🆕 missing (workflow exists, doc doesn't cover it).

**Core data rule:** on-hand for a product at a warehouse = `SUM(StockMovement.quantity)`
(check-in +, check-out −, adjustment ±). On-hand is never edited directly; nothing is
hard-deleted — corrections are reversals/adjustments (`lib/inventory.ts`).

> **Launch gate.** The manual and handbook are launch-gated on a clean registry: no ⚠️ / ❌ / 🆕
> may remain open at launch. Items still open are listed under **Open items** at the bottom —
> most are management/internal tooling or the not-yet-built QC form, and need a CEO decision on
> whether they belong in the manager manual.

## Summary (status after the July 21, 2026 reconciliation pass)

| Module | ✅ | ⚠️ | ❌ | 🆕 | Total |
|---|---|---|---|---|---|
| Inventory | 5 | 0 | 0 | 2 | 7 |
| Fleet | 6 | 1 | 0 | 2 | 9 |
| People / HR | 9 | 0 | 0 | 0 | 9 |
| Branch | 4 | 0 | 0 | 1 | 5 |
| Checklists | 3 | 0 | 0 | 0 | 3 |
| Management | 6 | 2 | 0 | 1 | 9 |
| Comms | 0 | 0 | 0 | 2 | 2 |
| Document Center | 2 | 0 | 0 | 0 | 2 |
| Auth / Access | 1 | 0 | 0 | 1 | 2 |
| **Total** | **36** | **3** | **0** | **9** | **48** |

All ❌ contradictions found at the start of this pass were fixed inline (see
`docs/DOC-RECONCILIATION.md`). The 3 ⚠️ and 9 🆕 remaining are the launch-gate open items.

---

## Inventory

| Workflow | What the system does (route) | Manual § | Handbook § | Status | Action |
|---|---|---|---|---|---|
| Check-In (invoice AI + confirm) | Upload distributor invoice → AI reader (Claude vision or mock) extracts lines, auto-matches to catalog; review + **Confirm** posts positive `check_in` movements. New/unknown items are created **unconfirmed** and blocked from check-out until vetted. (`/check-in`, `/api/check-in/parse`, `/confirm`) | Inventory Process & Procedure › Check-IN | — | ✅ | Aligned; no change. |
| Check-Out (UoM + hard stop + escalation) | Pick warehouse + technician + products; qty in **canonical UoM dropdown (no free text)**. **Unconfirmed-product hard stop** and **over-dispense (negative-stock) hard stop**, neither overridable by a manager. One-click **escalation thread** to Chief of Staff / Dir. Field Ops / COO. (`/check-out`, `/api/check-out`, `/escalate`) | Inventory Process & Procedure › Check-OUT + Over-dispense hard stop | — | ✅ | Escalation contacts corrected: "the CEO" → "the COO (Chris Slade)" to match `INVENTORY_ESCALATION_EMAILS`. |
| Reconcile (physical count) | Ledger of all movements with **"logged by"**; corrective **Adjust / Reverse / Correct** actions, each requiring a reason; nothing hard-deleted. (`/reconcile`, `/api/reconcile`) | Inventory Process & Procedure › Month-end reconciliation | — | ✅ | Aligned. |
| Alerts (anomaly / low-stock / savings) | Auto checks on each check-in + on demand: low-stock/reorder, price increase, duplicate invoice, negative stock, quantity spike, cost-saving opportunity. Acknowledge / dismiss / Discuss. (`/alerts`, `/api/alerts`, `/run`) | Inventory Process & Procedure › Alerts | — | ✅ | Added an **Alerts** subsection enumerating all alert types (manual previously named only low-stock). |
| Product catalog governance | Approved catalog + **confirm queue** (unconfirmed items blocked at check-out; confirm/merge, never delete); **divisions** GHP/L&O/Mosquito/Termite/Rodent/Other + subdivisions; **pack sizes** (`unitsPerCase`); non-chemical line. (`/manage/products`, `/manage/confirm`) | Inventory Process & Procedure › Approved-product catalog, units & divisions | — | ✅ | Aligned. |
| Reports & CSV export | Filtered charts + warehouse/product on-hand tables; CSV export of purchased/dispersed/on-hand. (`/reports`, `/api/reports/export`) | — | — | 🆕 | Not in the manual (analysis view). CEO: decide whether managers need it documented. |
| Stock on-hand import | Admin uploads PestPac On-Hand report or CSV; posts adjustment movements to make on-hand match the count (optional first-load reset). (`/manage/inventory`, `/api/manage/inventory-import`) | — | — | 🆕 | Admin/initial-load utility; document only if managers will run it. |

## Fleet

| Workflow | What the system does (route) | Manual § | Handbook § | Status | Action |
|---|---|---|---|---|---|
| Fleet registry + add/edit vehicle | Roster with maintenance spend, cost/mile, due-for-service; admin add/edit. (`/fleet`, `/fleet/[id]`, `/api/fleet/vehicle`) | Company Vehicles; New Vehicle Onboarding Checklist | Use of Company Vehicles | ✅ | Added a portal note to New Vehicle Onboarding (add vehicle + file docs in Fleet). |
| Fleet spreadsheet import | Admin re-imports the fleet workbook (Vehicle Fleet + Vehicle Status tabs); upsert by VIN/unit#. (`/api/fleet/import`) | — | — | 🆕 | Admin utility. |
| **Log Service / maintenance** | Record service by typing it in **or uploading a shop invoice** the AI parses into per-truck lines; odometer auto-advances. (`/fleet/service`, `/api/fleet/service`, `/parse`) | Routine Vehicle Maintenance Log; Routine Small Machinery/Equipment Maintenance Log | — | ✅ | **Flagship fix.** Rewrote both paper "glove-box / wall-mounted log" sections to the Fleet **Log Service** flow. Small non-vehicle equipment marked **verify** (no dedicated module yet). |
| Monthly vehicle inspection (digital, graded) | 20-pt graded form: Section A condition (12) + Section C compliance (8) + Section B maintenance review; critical fail raises a leadership alert; feeds quarterly scorecard. (`/fleet/[id]/inspect`, `/my-branch/inspections`, `/api/fleet/inspection`) | Vehicle Inspection Form; Monthly Responsibilities | — | ✅ | **Fixed.** Rewrote the blank paper form into the digital graded inspection. |
| Fuel (Coast statement upload) | Upload Coast `.xlsx`; parse + match to vehicle by unit/plate/card; idempotent; MPG/CPG plausibility filters. (`/fleet/fuel`, `/api/fleet/fuel/upload`) | Company Vehicles (fuel logging) | — | ✅ | Covered by the Company Vehicles portal note. |
| Vehicle documents + expiry reminders | Upload registration/title/insurance; AI suggests category + vehicle; confirm → filed; expiry coloring + HR reminders; registration syncs renewal date. (`/fleet/[id]`, `/management/documents`, `/api/fleet/document`) | Company Vehicles; New Vehicle Onboarding Checklist | — | ✅ | Onboarding note added. |
| Vehicle disposition / retirement | Retire / mark sold (sold/retired/totaled/traded/transferred) → inactive, history kept; reactivate. (`/fleet/[id]`, `/fleet/retired`, `/api/fleet/vehicle`) | — | — | 🆕 | Not in the manual. Add a short "Retiring a vehicle" note if managers do this. |
| Fleet reminders engine | Inspection-due, maintenance-due, registration (60d), loan payoff (45d), insurance renewal (90d), manual reminders; surfaced on `/fleet` + `/my-branch`. (`lib/reminders.ts`) | Company Vehicles (expiry reminders) | — | ✅ | Aligned. |
| Insurance policies + docs + expiry | AI-parse policy uploads; installment/renewal forecasting; renewals-in-90-days; company-wide `policy_renewal` reminders. (`/management/insurance`, `/api/insurance/*`) | Company Vehicles (insurance logging) — partial | — | ⚠️ | Manual mentions "insurance logging" only under Fleet; the management Insurance center is broader. **Open:** decide whether to describe it in the manual. |

## People / HR

| Workflow | What the system does (route) | Manual § | Handbook § | Status | Action |
|---|---|---|---|---|---|
| Employee lifecycle — add | HR/admin add employee; hire date auto-schedules 30/60-day reviews. (`/management/people`, `/api/personnel/lifecycle`) | Hiring / Onboarding | Employment / At-Will | ✅ | Aligned. |
| Offboarding — terminate / exit / reactivate | Record separation (type/reason/last day/rehire) → inactive + **login disabled**; exit interview complete/bypass; reactivate restores. (`/management/people/[id]`, `/api/personnel/lifecycle`) | Termination Policy | Resignation; At-Will | ✅ | Added a portal note to Termination Policy (separation record, login disable, exit interview). |
| New-hire 30/60-day reviews | Auto-created `due`; assign reviewer; typed form; 3 signatures (reviewer + employee + HR approval, HR gated on the first two); tokenized employee link. (`/management/people/reviews`, `/reviews/[id]`, `/review-sign`) | Hiring / Onboarding | — | ✅ | Aligned. |
| ATS pipeline + interview scorecards | Jobs → candidates through applied→screening→interviewing→offer→onboarding→hired; assign interview → **required scorecard** (8 competencies + recommendation + summary). (`/management/people/jobs`, `/candidates/[id]`, `/me/interviews/[id]`) | Hiring / Onboarding; Hiring & Onboarding Roadmap | How and Why You Were Selected | ✅ | Aligned (roadmap's Indeed + email templates remain the human-step reference). |
| Pre-hire onboarding (magic link) | Candidate completes personal/emergency info, drug-test & background consent, policy acks, and **handbook acknowledgment** via a personal token link; HR approves → creates employee. (`/management/people/prehires`, `/onboarding/[token]`) | Onboarding Process for New Technicians; Hiring/Onboarding | Using the Clements Portal › Onboarding paperwork | ✅ | Aligned (3-day in-person onboarding still valid). |
| PTO — request / approve / calendar | Employee requests (business days auto-counted) → branch supervisor + HR approve → team/company calendar + balances. (`/me/pto`, `/my-branch/pto`, `/management/people/pto`, `/api/pto`) | Paid Time Off (PTO) | Using the Clements Portal › Time off; PTO policies | ✅ | Manual aligned. **Handbook:** corrected PTO submission channel ("via Paychex Flex" → "through the Clements portal") in both appendices; timing/entitlements unchanged. |
| Handbook acknowledgment | Typed-signature ack, version-stamped; in-app, tokenized link, or onboarding; HR roster of who's signed the current version. (`/resources/handbook`, `/management/people/handbook`, `/api/documents/ack`) | Hiring / Onboarding | Using the Clements Portal › Handbook and acknowledgments | ✅ | Aligned. Bumping the handbook to v2 re-prompts all prior acknowledgers. |
| Personnel records + signatures | File Write-up / Note / Recognition / **Accident report** on a team member; supervisor e-signature auto-captured; collect employee/HR/witness signatures in-app or by link; auto-notify HR + leadership. (`/my-branch/team/[id]`, `/api/personnel/*`, `/sign`) | Employee Disciplinary Action Procedure/Form; Workplace Accidents / Report | General Rules; Progressive Discipline | ✅ | **Fixed.** Added portal notes to the Disciplinary and Workplace-Accident sections (records now filed in the portal, not an editable PDF on the drive / hardcopy). Procedures preserved. |
| Training assignment / submit | Assigned courses; start → submit → graded vs passing score; completion filed to personnel record; reminders. (`/me/training/[id]`, `/management/training`, `/api/training/*`) | Onboarding Process; Monthly Responsibilities (training) | — | ✅ | Aligned. |

## Branch

| Workflow | What the system does (route) | Manual § | Handbook § | Status | Action |
|---|---|---|---|---|---|
| Branch dashboard + reminders | Missed-checklist banner, pending PTO, inspection/scorecard tiles, event-driven reminders, audit follow-ups. (`/my-branch`) | Weekly & Monthly Responsibilities | — | ✅ | Aligned. |
| Branch Hub documents + contacts | Certified-operator (Ch. 482) banner; licenses/leases with expiry; key contacts; repair-data button. (`/my-branch/documents`, `/api/branch/*`) | FDACS On-site Document Management | — | ✅ | Aligned. |
| Warehouse safety inspection (digital, scored) | 3-section Yes/No scored form, corrective note on any "No"; critical fail alerts leadership; feeds scorecard; one/branch/month. (`/my-branch/warehouse`, `/api/fleet/warehouse`) | Warehouse Safety | — | ✅ | **Fixed.** Replaced the blank paper form (Inspector/Date/Signature) with the digital-inspection description. |
| Quality Control | **"Coming soon"** placeholder; scorecard QC metric has no data source yet. (`/my-branch/qc`) | Monthly Responsibilities (QC) | — | 🆕 | **Not built.** Open item — the manual + scorecard reference QC. |
| Branch scorecard (manager view) | Read-only quarterly scorecard pinned to the manager's branch. (`/my-branch/scorecard`) | Manager Expectations (KPIs) | — | ✅ | See Management › Manager scorecards. |

## Checklists

| Workflow | What the system does (route) | Manual § | Handbook § | Status | Action |
|---|---|---|---|---|---|
| Weekly attested oversight checklist | Work the list + typed-signature attestation; one completion per branch/week; append-only. (`/checklists`, `/checklists/[key]`, `/api/checklists`) | Weekly Responsibilities | — | ✅ | Aligned. |
| Missed-checklist penalty + clearing | Unsigned elapsed weeks recorded as `ChecklistMiss`; **only CEO/HR can clear** (with a note); never reopened/deleted. (`/api/checklists/miss`) | Weekly Responsibilities | — | ✅ | Added a sentence to the Weekly note about the missed-checklist penalty. |
| Checklist oversight rollup | Senior-leadership grid of who signed per branch + open misses. (`/checklists/oversight`) | Weekly / Monthly (leadership rollup) | — | ✅ | Aligned. |

## Management

| Workflow | What the system does (route) | Manual § | Handbook § | Status | Action |
|---|---|---|---|---|---|
| Management dashboard (budget vs actual) | Month/YTD KPI strip, production-vs-budget, attrition %, revenue by LOB, tech drill-down — from ingested MBR data. (`/management`) | Monthly Responsibilities › KPI Review | — | ✅ | Aligned. |
| Board / Executive dashboard | Full company financials (P&L, balance sheet, cash flow, ratios); board observers read-only. (`/management/board`) | Manager Expectations (KPIs / All-Hands) | — | ✅ | Aligned (exec surface). |
| Insights grounded chat | Conversational Q&A grounded only in the MBR snapshot; admin + senior leadership only. (`/management/insights`, `/api/insights`) | Monthly Responsibilities (Insights assistant) | — | ✅ | Aligned. |
| Sales & attrition + Sales Center sync | Live Sales Center card synced from the shared Google Sheet; MBR new-sales/cancellation views. (`/management/sales`, `/api/sales/sync`) | Sales Center Clean Up (PestPac) | — | ⚠️ | Manual's Sales Center Clean Up (PestPac lead lifecycle) is unchanged & accurate; the **portal sales reporting dashboard** isn't described. **Open:** add a short note if managers use it. |
| Manager scorecards | 10 weighted metrics; auto-suggested Met/Not from MBR + real compliance completion; admin-editable. (`/management/scorecards`, `/api/management/scorecard`) | Manager Expectations; see `docs/manager-scorecard-review.md` | — | ✅ | Aligned. |
| Branch audits + prep precheck | Quarterly Dir-Field-Ops audit: prep checklist, ride-along evals, scored sections, follow-ups pushed to manager dashboard. (`/management/audits`, `/api/management/audit`) | Monthly Responsibilities ("Prep for Dir of Field Ops visit") | — | ⚠️ | Manual references the visit but not the **digital audit + follow-ups**. **Open:** expand if the manual should cover the audit tool. |
| Training courses & assignment | Admin builds courses + quizzes, assigns to employees (emailed), tracks completion. (`/management/training`, `/api/management/course`) | Onboarding; Monthly Responsibilities | — | ✅ | Aligned. |
| MBR ingestion / upload | Admin uploads MBR PDF → AI extract → confirm → dashboards. (`/management/upload`, `/api/management/upload`) | — | — | 🆕 | Admin utility feeding the dashboards. |
| Compliance Command Center | Read-only RAG board + coverage matrix + renewals + obligations, aggregating Branch Hub / insurance / vehicle docs; senior leadership. (`/management/compliance`) | FDACS On-site Document Management; Warehouse Safety | — | ✅ | Underlying sources documented; the rollup is a senior-leadership view. |

## Comms

| Workflow | What the system does (route) | Manual § | Handbook § | Status | Action |
|---|---|---|---|---|---|
| Internal messages / threads | Start/reply to threads with recipients; **Discuss** buttons across the app seed context (alerts, reminders, escalations). (`/inbox`, `/api/threads`) | — | — | 🆕 | Not in the manual. The inventory escalation thread is documented under Check-Out. **Open:** decide if threads warrant a manual note. |
| Company Bulletin | Authors post stories/announcements/shoutouts/events (+ optional required acknowledgment); everyone reads; company calendar. (`/bulletin`, `/api/bulletin/*`) | — | — | 🆕 | Not in the manual. **Open:** decide if it belongs. |

## Document Center

| Workflow | What the system does (route) | Manual § | Handbook § | Status | Action |
|---|---|---|---|---|---|
| Employee Handbook (read + acknowledge) | Renders the handbook; typed-signature acknowledgment vs current version. (`/resources/handbook`) | — | Using the Clements Portal | ✅ | Aligned. |
| Manager Operating Manual (read) | Manager/admin-only reference with TOC; no acknowledgment. (`/resources/manual`) | (this document) | — | ✅ | Aligned. |

## Auth / Access

| Workflow | What the system does (route) | Manual § | Handbook § | Status | Action |
|---|---|---|---|---|---|
| Login / session | Email + password (scrypt), 30-day cookie session; role-based home. (`/login`, `/api/auth/*`, `lib/auth.ts`) | Onboarding (credentials) | Using the Clements Portal | ✅ | Aligned. |
| Roles & access control | `admin` / `manager` / `employee` + flags `seniorLeadership`, `hrAccess`, `boardObserver`, `canPostBulletin`; branch-locking; board-observer read-only. (`lib/auth.ts`) | — | — | 🆕 | Cross-cutting infrastructure; not a manual procedure. Listed for completeness. |

---

## Open items (launch-gate)

Resolve or consciously accept each before launch. None are contradictions — they are workflows
the manager manual does not yet describe (or, for QC, is not yet built):

1. **Quality Control form (🆕, not built)** — `/my-branch/qc` is a "Coming soon" placeholder, yet
   the manual's monthly list and the scorecard both reference QC. Build it or remove the
   references. *(CEO decision + engineering.)*
2. **Management/insurance, branch audits, sales reporting dashboard (⚠️)** — the manual touches
   the underlying activity but not these portal screens. Decide whether the manager manual should
   describe them (they are largely leadership tools).
3. **Vehicle disposition, fleet/stock/MBR imports, Reports/CSV export (🆕)** — admin/utility
   flows. Document any that managers actually operate.
4. **Internal threads & Company Bulletin (🆕)** — decide whether these belong in the manual.
5. **Branch count (verify)** — code carries **four** branches (Vero Beach HQ, Stuart, Orlando,
   **Naples**); `CLAUDE.md` and the manual name three. Confirm whether Naples is live.
6. **Small non-vehicle equipment maintenance (verify)** — no dedicated portal module yet; the
   manual now routes it to Warehouse Inspection notes and flags the gap.

See `docs/DOC-RECONCILIATION.md` for the full before/after of every fix in this pass.
