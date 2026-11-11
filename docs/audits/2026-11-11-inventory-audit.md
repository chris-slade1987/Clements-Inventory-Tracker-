# Inventory Module Audit — 2026-11-11
Baseline commit: 1eba5f4   ·   Prior audit: 2026-11-07-audit.md (§ "Inventory, fleet & branch operations")
Scope: Inventory ONLY. COO framing: *"it's gotten overcomplicated — defeating the entire purpose of it."*
Team (read-only): **Daily Flow** (Check-In / Check-Out on a phone) · **Visibility** (dashboard, reports, reconcile, counts, alerts) ·
**Catalog & Admin** (product model, Inventory Administration) · **Plumbing & Navigation** (loaders, healers, matching, routes, access).

## The diagnosis in one paragraph
The module's job is two movements — **Check-IN** and **Check-OUT** — and the core (both post rows to `stock_movements`; on-hand = SUM) is still sound.
Everything around it has grown by accretion: a branch manager sees **~10 inventory screens**, a super admin **~21 routes**; a product has
**~9 states** built from 3 booleans plus marker phrases buried in free-text `notes`; **7 automated routines** and **4 screens** can change a
product's catalog status; there are **6 separate merge implementations**, **~15 product-name matchers** and **~10 alias maps**; Check-Out has
**4 ways to identify a product**, **8 overlays** and **2 different "request a product" forms**; the same number ("spend", "on hand", "low stock")
is shown in 3–5 places with different definitions. Much of the plumbing is finished history (one-off loads for July–October) that still sits in
the deploy script or runs on page loads. Several of the "fixes" of the past three weeks — including runtime data loaders and the 11/10 catalog
cleanup — added to this; they did their job and should now be retired, not kept.

## Progress since last audit (inventory)
- Dashboard trimmed per COO (removed line-of-service table + period tiles; inventory-only alerts at top) — 8290d37.
- Dispersals report real-time; Purchases default no longer hides new receipts — 8290d37.
- Reconcile reversal detail simplified.
- PestPac receipts loaded at runtime (Orlando 11/3; Vero 11/3 + 11/4) with a duplicate-receipt guard.
- 11/5 bulk approval reversed; catalog shows full product descriptions; imports land off-catalog; in-app approvals are stamped — c523266.

## Correctness problems found (fix before simplifying — these make numbers wrong)
| # | Problem | Where | Effort |
|---|---|---|---|
| K1 | **Over-dispense guard is off for most products.** "Counted" = an adjustment whose reason matches `/count\|reconcil/`; the 10/30 baseline reason ("Go-live on-hand baseline…") doesn't match, so almost everything is "not yet counted": no server block, a 40-unit cap enforced only in the browser, a "Not yet counted" badge instead of on-hand. (prior A1) | `lib/stock-count.ts:29-31`, `lib/onhand-baseline.ts:32`, `app/api/inventory/checkout/route.ts:108`, `ScanCheckoutClient.tsx:12,350` | S |
| K2 | **Voided check-outs still count as dispersed** — dispersal report, technician spend, dispersed $ and the reorder run-rate filter `type:"check_out"` only, so voids/reversals inflate them and Dispersed won't tie to on-hand. | `lib/reporting.ts:698-745,1034-1042`, `lib/reorder.ts:93` | S |
| K3 | **No role/branch checks on Reconcile** — any login (incl. technicians) can post adjustments/reversals to any branch via the API; the page lists every branch. Legacy `/api/check-out` POST is unused but live with no role check. (prior A4) | `app/api/reconcile/route.ts:29-32`, `app/api/check-out/route.ts:18-29` | S |
| K4 | **Branch not locked for managers** — Check-Out shows a branch switcher the server then rejects (prior A3); Check-In defaults to `warehouses[0]` (Naples) and its confirm API posts to any branch, while undo only allows the user's own branch. | `check-out/page.tsx:76`, `check-in/page.tsx:63`, `api/check-in/confirm/route.ts:39-58` | S |
| K5 | **Stock Import can wipe the database** — a "first-load reset" checkbox deletes all movements, invoices, products and alerts; it also creates products as approved (schema default) and matches by exact name only (post-rename it would create approved duplicates). | `app/api/manage/inventory-import/route.ts:33-41,55-71` | S |
| K6 | **Product-request holes** — approve posts a typed on-hand even for a check-in-created product (double count, prior A5); two admins can both approve (A6); deny strands received stock (A7); duplicate requests for the same product; deciding in Catalog Review never closes the linked request, and approving a stale one resurrects a merged-away product. | `api/inventory/product-request/route.ts:151,254-270,309-347`, `ProductRequestsClient.tsx:185` | S each |
| K7 | **Off-catalog products reach the Check-Out cart** via barcode/photo and only fail at Submit with a 409. | `ScanCheckoutClient.tsx:133-164,281-315`, `api/inventory/identify/route.ts:36-40` | S |
| K8 | Check-In **× case multiplies again on every tap**; the unit dropdown relabels without converting (prior A10). Duplicate-invoice guard is outside the transaction and matches distributor text exactly (prior A11 partial). | `CheckInClient.tsx:631-652`, `api/check-in/confirm/route.ts:86-112` | S–M |
| K9 | Inventory dashboard **budget bars use hard-coded placeholder budgets** (only one tile says so); branch managers see **all branches' alerts** ("View all" bounces them). | `lib/budgets.ts:1-14`, `dashboard/page.tsx:103-108,178,199-245` | S |
| K10 | Reorder run-rate divides by 90 days even with ~12 days of history → reorder alerts suppressed (verify). | `lib/reorder.ts:33,96-98` | S |
| K11 | Latent: a bump of the 10/30 baseline revision would reset to the count sheet and **erase every movement since 10/30** (prior A2). Retire the loader (see L2). | `lib/onhand-baseline.ts:30,134-166` | S |
| K12 | Latent: deploy-time inventory steps include a hard-delete reset and an every-deploy canonical reconcile that would undo human catalog decisions — **if** the build ever writes to prod. Established 11/3 that build-time writes don't reach the live DB; verify the Vercel build `DATABASE_URL`, then delete the steps (L1). | `scripts/deploy-db.ts:730-1007`, `scripts/catalog-canonical.ts:140-235` | S to verify |

## Ranked plan — Now / Next / Later

### NOW — fix the wrong numbers and remove the dangerous tools (all S, ~1–2 days total)
1. **One stock rule:** on-hand = sum of movements, block anything that would go negative — drop "counted", the 40 cap and the exemption (K1). *Flow/Visibility*
2. **Voids net out** of dispersals, technician spend and reorder (K2). *Visibility*
3. **Lock the branch** for managers on both movements; role + branch checks on Reconcile; delete legacy `/api/check-out` POST (K3, K4). *Flow/Plumbing*
4. **Remove Stock Import** (and its wipe) and the two CSV catalog-import buttons; counts go through Stock Count, products through Request / Add product (K5). *Catalog*
5. **Close the product-request holes** (K6) and keep off-catalog products out of Check-Out entirely — hidden from search/photo; a scanned one says "waiting for approval" (K7). *Catalog/Flow*
6. **Dashboard truth:** remove placeholder budget bars, the copied spend panels, the New-hire reviews card, and the all-branch alerts tile for managers (K9, D2, D4). *Visibility*

### NEXT — collapse the structure (M each, ~1–2 weeks)
7. **Manager navigation = Check-In · Check-Out · Stock · Reports.** "Stock" = on-hand for my branch + Count + one **History** (In / Out / All, with Undo on both — check-ins currently can't be undone after leaving the receipt). Absorbs History, Stock Count, the Check-Out sub-nav and the manager use of Reconcile; Alerts become a panel. Photo Catalog moves to admin. *Plumbing/Flow*
8. **Check-Out = scan → cart → submit.** Each barcode beep adds 1 and the camera stays open; one search box (approved only); AI photo hidden behind a setting; submit from the cart with an optional collapsed signature; one over-dispense message ("leadership notified" — no second message box); one request-a-product form. *Flow*
9. **Check-In = snap → review → confirm.** Auto-read on file pick; each line is product · qty (cases/units toggle) · price; remove the unit dropdown, the editable raw-text field and the chat panel; skipped-line count on the Confirm button instead of a checkbox; match by **item number + alias map** first (prior A12). *Flow/Plumbing*
10. **Reports = Received · Dispersed · On-hand** (5 tabs → 3): delete Overview (duplicates On-hand, ignores branch lock), fold Spend into a summary strip on Received; one shared date-window helper; delete ~400 lines of unused report functions. *Visibility*
11. **Catalog admin = Products · Decisions · Labels.** Catalog Review's 5 tabs + Requests become one **Decisions** list (one row per pending product, request photos inline, Approve / Merge into… / Retire, deciding closes the request; "possible match" hint replaces the Duplicates tab). Delete `/inventory/catalog` (the product Edit screen covers barcodes + fields). Scan Intelligence leaves the tab bar. One **Retire** action, blocked while stock is on hand. **One shared merge function** (moves photos, checks units) used by every path. *Catalog*

### LATER — retire the plumbing (M–L)
12. **One product status** — `pending | active | retired | merged (+ mergedIntoId, decidedBy/At)` replaces `active/approved/confirmed` + notes markers; Check-Out allows `active` only. *Catalog*
13. **Healers out of the page path:** verify the prod markers, then remove the five inventory `ensure*` calls from the layout and the repeat calls in pages (cold-start latency; prior D1). *Plumbing*
14. **Delete the finished one-off loaders** (7/27, 7/31, Aug–Sep invoices + dispersals, purchase history, inventory reset, catalog canonical/cleanup scripts, backfills, catalog CSV import — ~4,000 lines) from `deploy-db` and the repo; archive their data under `docs/archive/`. *Plumbing*
15. **One product resolver** (`itemNumber → exact name → alias`) backed by one alias table on the product; retire the ~15 matchers and ~10 maps as their callers go. *Plumbing*
16. **In-app shipment upload:** a super-admin "Upload PestPac transfer report" on Check-In (reusing the receipts core), so new shipments never need a developer commit. *Plumbing*
17. Reorder: fix the run-rate denominator; one low-stock definition shown in one place (My Branch "Needs attention"). Defer par levels (prior A14); **drop** prior A16 (dispersal $ vs production $) as out of scope. *Visibility*

## Quick wins (S, can ship together)
- Pass `branchLocked={!isAdmin}` on Check-Out; server-resolve the warehouse on Check-In.
- Role check on `/api/reconcile`; delete `/api/check-out` POST.
- Remove the Stock Import reset branch (or the whole tab).
- Remove dashboard budget bars and the New-hire reviews card.
- Auto-read invoice on file pick; hide "Mock parser / AI live" text from managers.
- Remove the second over-dispense "message senior management" box.
- Labels page lists approved products only.
- Add `/inventory/photos` and `/manage/product-requests` to `lib/access-paths.ts`.
- Fix stale docs: Reports defaults (WORKFLOWS row 75, manual 1150–1154), Reconcile-vs-Stock Count (manual 1127), the dead "line-of-service ledger" row 74, and the manual's claim that every import lands off-catalog (Stock Import doesn't).

## What "simple" looks like (target state)
**Manager** — 4 items. *Check-In:* branch fixed → snap invoice → product/qty/price list → "Check in 9 of 10 lines" → receipt with Undo.
*Check-Out:* branch fixed → pick technician → scan, scan, scan (cart fills) → Submit → receipt with Undo. *Stock:* my on-hand, Count, History (in/out, undo). *Reports:* Received · Dispersed · On-hand for my branch.
**Super admin** — the same, plus a branch switcher, plus *Catalog:* Products (one list → view → edit) and Decisions (one inbox: approve / merge / retire).
**Product** — pending → active (approved) | merged | retired. Nothing automatic changes status after go-live.

## Full findings by lens (condensed; file refs in the auditors' notes below)
**Daily Flow:** C1 Check-In line card has 7 controls · C2 × case compounds · C3 chat panel duplicates the editable list · C4 warehouse default/lock inconsistent · C5 duplicate-invoice guard bypassable · C6 reader ignores item numbers, matches off-catalog · C7 extra "Read invoice" tap + developer copy · C8 skip-checkbox · O1 counted/cap rule · O2 3 actions per scan + separate review screen · O3 off-catalog reaches cart · O4 4 identify methods · O5 branch switcher rejected · O6 double escalation · O7 Check-Out doubles as the inventory hub (sub-nav) · O8 heavy page load · H1 history split three ways · H2 check-in undo only from receipt · H3 five filters before the list · P1 two request forms · P2 duplicate requests · P3 approval holes · X1 legacy API · X2 manual over-describes admin tooling in manager steps · X3 labels for off-catalog products.
**Visibility:** D1 placeholder budgets · D2 dashboard copies 3 report panels with a different date window · D3 all-branch alerts for managers · D4 New-hire reviews card on Inventory · D5 low stock in 5 places, 2 definitions · R1 Overview duplicates + ignores branch lock · R2 5 tabs → 3 · R3 voids counted as dispersed · R4 $ and units in one total column · R5 duplicated default windows, docs drifted · R6 ~400 lines dead report code · R7 `movementDate` vs `createdAt` · C1 Reconcile unguarded · C2 three ledgers · C3 manual sends counts to Reconcile · S1 counted-by-regex · S2 three on-hand tables · A1 reorder run-rate · A2 non-inventory tools on Alerts · A3 three diagnostics endpoints, token in URL · X2 full-ledger scans.
**Catalog & Admin:** P1 ~9 states from 3 flags + notes markers · P2 Confirm vs Approve are one decision split in two · P3 7 automated status-changers that conflict; 3 name sources; seed overwrites admin edits each deploy · P4 two UoM libraries · C1 three catalog lists, two editors, three barcode-link places · C2 four ways to remove, none checks stock · C3 access registry grants Catalog to levels the page bounces · D1 5 tabs + Requests = one inbox; badge undercounts · D2 "Keep all" not persisted · D3 six merge implementations, inconsistent · S1 photos in four places · S2 Scan Intelligence is AI tooling, not a daily tab · I1 Stock Import creates approved junk + duplicates · I2 three import paths · X1 self-healing writers on page loads · X2 naming drift (Product Review vs Catalog Review).
**Plumbing & Navigation:** R1 14 sequential layout healers (5 inventory) · R2 re-called in pages; `ensureCatalogBaseline` hits the DB every load · R3 baseline revision bump erases activity · L1 ~14 deploy-time inventory steps incl. a hard-delete reset · L2 shipments need a developer commit · L3 Stock Import wipe · N1 ~15 matchers / ~10 maps · N2 Check-In uses the weakest matcher · P1 six merges · P2 rename/demote built twice · P3 legacy API · P4 three adjust paths, three on-hand views, three check-out views · V1 manager sees ~10 screens · V2 super admin ~21 routes · V3 legacy redirect · A1 two registry items unenforced · A2 write APIs rely on the layout gate · A3 registry will shrink with V1/V2.

## Prior recommendations — status (2026-11-07 inventory items)
| Item | Status |
|---|---|
| A1 over-dispense guard off for go-live-counted products | **Not done** (K1) |
| A2 baseline re-run may erase activity | **Not done / unverified** (K11) |
| A3 branch switcher shown but rejected | **Not done** (K4) |
| A4 reconcile / legacy check-out APIs unguarded | **Not done** (K3) |
| A5 approving a check-in request double-posts | **Partial** — request created without on-hand, but approve still posts a typed qty (K6) |
| A6 two admins both approve | **Not done** (K6) |
| A7 deny strands received stock | **Not done** (K6) |
| A8 merges ignore UoM; merge logic duplicated | **Not done — worse** (6 copies) |
| A9 discarding a product with stock | **Not done** for people (cleanup handles it; manual actions don't) |
| A10 × case compounds / unit doesn't convert | **Not done** (K8) |
| A11 double-tap double post | **Partial** (button disables; no idempotency; guard outside transaction) |
| A12 invoice reader ignores item numbers | **Not done** (#9) |
| A13 re-baseline left requests pending | **Partially superseded** by the 11/10 cleanup; Catalog Review decisions still don't close requests |
| A14 par levels / ordered ETA | **Defer** until reorder run-rate is fixed |
| A15 lot numbers / restricted-use | Not assessed (out of simplification scope) |
| A16 dispersal $ vs production $ | **Recommend dropping** (adds a third measure) |
| D1 layout healers (perf) | **Not done — grown** (receipts + catalog cleanup added) |
