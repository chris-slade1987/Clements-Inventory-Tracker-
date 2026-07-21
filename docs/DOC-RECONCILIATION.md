# Doc Reconciliation Audit — Manager Manual & Employee Handbook

**Date:** July 21, 2026
**Scope:** Reconcile `prisma/data/manager-manual.md` and `prisma/data/handbook.md` against what
the Clements Command & Control portal actually does, using the code as ground truth (routes,
API handlers, `lib/**`, `prisma/schema.prisma`). Companion: `docs/WORKFLOWS.md` (the registry).

**Method:** every workflow was surveyed from code. The manual was **rewritten** where it
described a process the ERP now owns. The handbook is a legal document — **policy language was
not reworded**; only one factual portal *mechanic* was corrected inline, and everything
substantive was flagged in `prisma/data/handbook-suggestions.md`.

**Versioning:** both documents are seeded from these `.md` files by `prisma/seed-documents.ts`
(idempotent by slug; acknowledgments are append-only and are never touched). Both were bumped to
**Version 2** for this pass (forward-only bump added to the seed). Bumping the **handbook**
re-prompts every prior acknowledger (`HandbookAck` compares `acknowledgedVersion === version`).
The **manual** requires no acknowledgment.

---

## A. Manager Operating Manual — fixed inline

Each item below described a paper/drive/spreadsheet process the portal has replaced. The manual's
voice and all still-accurate operational guidance (safety, hurricane prep, discipline, marketing,
people-first expectations) were preserved.

| # | Workflow | What the manual said | What's correct now | Disposition |
|---|---|---|---|---|
| 1 | **Vehicle maintenance logging** (flagship) | "Routine Vehicle Maintenance Log … *should remain in the glove box of each fleet vehicle*. … log all routine maintenance." | Maintenance is logged in **Fleet → Log Service** (`/fleet/service`) — typed in or via an AI-parsed shop invoice; odometer auto-advances; cost + history on the vehicle record. | **FIXED** — section rewritten. |
| 2 | **Small machinery / equipment maintenance** | "Routine Small Machinery/Equipment Maintenance Log … *should remain hung up in each warehouse*." | Equipment tracked as a fleet asset uses the same **Log Service** flow. Non-vehicle small equipment has **no dedicated module yet**. | **FIXED** — rewritten; residual gap marked **verify**. |
| 3 | **Monthly vehicle inspection** | Blank paper "Vehicle Inspection Form" with signature lines. | Digital **20-pt graded** inspection at `/fleet/[id]/inspect` (Section A condition 12 + Section C compliance 8 + Section B maintenance review); critical fail alerts leadership; feeds the scorecard. | **FIXED** — rewritten. |
| 4 | **Warehouse safety inspection** | Portal note present, but the blank "Inspector / Date / Signature" paper form remained below it. | Digital 3-section scored form at `/my-branch/warehouse`; inspector + date captured from sign-in; critical fail alerts leadership; feeds the scorecard. | **FIXED** — blank form replaced with the digital description. |
| 5 | **Disciplinary write-up filing** | "Disciplinary Action Form editable PDF … accessed at Management Drive … submitted to the Director of HR." | Write-ups are filed as **personnel records** at `/my-branch/team/[id]` with auto-captured supervisor e-signature, in-app/linked employee + HR signatures, and auto-notify. | **FIXED** — portal note added; the *procedure* (verbal→written→escalation) preserved. |
| 6 | **Workplace accident report filing** | "Submit hardcopy … save scanned copies on Management Drive (… Workplace Accident Reporting)." | Filed as an **Accident report** personnel record (`/my-branch/team/[id]`): captures the report + supervisor checklist, e-signatures (employee/supervisor/witness), auto-notify. | **FIXED** — portal note added; on-scene response steps preserved. |
| 7 | **Inventory over-dispense escalation contacts** | Escalation goes to "the Chief of Staff, the Director of Field Operations, and **the CEO**." | `INVENTORY_ESCALATION_EMAILS` targets Julie Glanville (Chief of Staff), Graham Foster (Dir. Field Ops), and **Chris Slade (COO)** — not "the CEO." | **FIXED** — corrected to "the COO (Chris Slade)" with names. |
| 8 | **Inventory Alerts coverage** | Named only "Low-stock alerts." | Six alert types run (low-stock/reorder, price increase, duplicate invoice, negative stock, quantity spike, cost-saving). | **FIXED** — added an **Alerts** subsection. |
| 9 | **Offboarding / termination record** | In-person meeting + paper letter only. | Portal records the **separation** (type/reason/last day/rehire), flips the employee inactive, **disables their login**, and opens an **exit interview**. | **FIXED** — portal note added to Termination Policy; meeting procedure preserved. |
| 10 | **New vehicle onboarding docs** | "Place copy … in the glove box / designated folder." | Vehicle is added in Fleet and registration/title/insurance are filed in the **document center** with expiry reminders (glove-box copies still kept for the field). | **FIXED** — portal note added. |
| 11 | **Missed weekly checklist** | Weekly note described the attested checklist + rollup only. | Unsigned elapsed weeks become a **missed checklist that only CEO/HR can clear**. | **FIXED** — one clause added to the Weekly note. |

Also bumped: the manual's in-body header to **Version 2 · July 21, 2026** with a one-line note of
what changed.

## B. Manager Operating Manual — already aligned (verified, no change)

The prior pass had already reconciled these; code confirms they are accurate: Inventory Check-In,
Check-Out (UoM + hard stops), Reconcile, product catalog/divisions/pack sizes; PTO; Hiring/ATS +
online onboarding + 30/60-day reviews; Weekly/Monthly attested checklists + leadership rollup;
FDACS On-site docs → Branch Hub; Management dashboards + Insights for KPI/All-Hands prep.

Left intentionally unchanged (still-accurate, non-software or external): manager expectations,
uniform/rain-day/callback/absence/extra-days policies, cleaning procedures, hurricane prep,
Drug-Free Workplace, marketing strategy, the paper accident/disciplinary **templates** (kept as
on-scene references), and the **Sales Center Clean-Up** procedure (PestPac lead lifecycle — the
portal does not replace it).

---

## C. Employee Handbook — legal document (policy NOT reworded)

### Corrected inline (factual mechanic only)

| Workflow | What the handbook said | What's correct now | Disposition |
|---|---|---|---|
| **PTO request submission** | Both PTO appendices: requests "must be submitted **via Paychex Flex** at least 2/3 weeks in advance." | PTO requests are submitted **through the Clements portal** (the handbook's own "Using the Clements Portal" section already says so). | **FIXED (mechanic only)** — channel corrected to "through the Clements portal." **Advance-notice windows and every PTO entitlement (allotment, rollover, payout, forfeiture, cap) are verbatim.** |

Because this is a wording change to a signed document, the handbook was bumped to **Version 2**,
and **every employee who acknowledged v1 will be re-prompted to acknowledge v2**. This is the only
inline change; the in-body header note states the entitlements are unchanged.

### Flagged (not changed) — routed to `prisma/data/handbook-suggestions.md`

- **Why the PTO edit + re-acknowledgment cost** — flagged for HR/legal to confirm they accept the
  re-acknowledgment and the printed portal name (item 15).
- **Paychex still owns payroll / 401(k) / time-and-attendance** — the "web clock", time-sheet, and
  401(k) references were **left unchanged** because those functions did not move to the portal
  (item 16).
- **Sick-day / absence call-out mechanic (verify)** — still "by phone call"; the portal does not
  capture call-outs; left as-is and flagged (item 17).
- **"Posting Work to Mobile App" (PestPac)** — accurate and unchanged; the portal does not track
  per-stop service (item 18).
- Pre-existing legal/consistency flags (weapons-in-vehicle, NLRA, deductions, drug-testing, FMLA
  coverage, non-solicitation, etc.) remain in items 1–14 for counsel — untouched.

---

## D. Counts

**Discrepancies found this pass (before fixes):**

| Severity | Count | Items |
|---|---|---|
| ❌ Contradicts | 6 | Manual A1–A6 (maintenance logs, equipment log, vehicle inspection form, warehouse-safety form, disciplinary filing, accident filing) |
| ⚠️ Stale | 6 | Manual A7–A11 (escalation contacts, alerts coverage, offboarding record, vehicle-onboarding docs, missed-checklist) + Handbook C (PTO channel) |
| 🆕 Missing | see registry | Reports/export, imports, disposition, QC (not built), MBR, threads, bulletin, insurance/audits/sales dashboards |

**Result after this pass** (registry status): **✅ 36 · ⚠️ 3 · ❌ 0 · 🆕 9** across 48 workflows.
All contradictions resolved. The 3 ⚠️ + 9 🆕 are the launch-gate open items below.

## E. Open items for the CEO

1. **Build or de-scope Quality Control** — `/my-branch/qc` is "Coming soon" but the manual and the
   scorecard both reference QC reports. (Not-built; needs engineering + a decision.)
2. **Confirm the branch list** — code carries **four** branches including **Naples**; the docs and
   `CLAUDE.md` say three (Vero Beach HQ, Stuart, Orlando). Is Naples live?
3. **Accept the handbook v2 re-acknowledgment** — confirm HR is comfortable re-prompting every
   employee for the PTO-channel wording fix, and that "the Clements portal" is the name to print.
4. **Decide manual coverage for leadership/utility tools** — Insurance center, Branch Audits,
   Sales reporting dashboard, MBR/fleet/stock imports, Reports/CSV, vehicle disposition, internal
   threads, and Company Bulletin exist in the portal but are not in the manager manual. Document
   the ones managers actually operate; consciously leave the rest.
5. **Small non-vehicle equipment maintenance** — no dedicated portal module; decide where routine
   service for backpack sprayers / B&G units / mist blowers should be captured.
