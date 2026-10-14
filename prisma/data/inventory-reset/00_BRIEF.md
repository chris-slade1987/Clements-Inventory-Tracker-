# CanopyOS: Inventory Reset (Purchases, Tech Disbursements, On-Hand)

**For:** Claude Code, working in the CanopyOS repo (Vercel project "canopy", Neon Postgres).
**From:** Chris Slade, COO, Clements Pest Control. Prepared 10/13/2026.
**This package replaces** all earlier inventory handoffs (`CanopyOS_Inventory_Checkout_Spec.md` §6, `CLAUDE_CODE_Inventory_Handoff_AugSep2026.md`, `CLAUDE_CODE_Sept2026_...md`). Where they conflict, this file wins.

---

## Goal

Wipe and rebuild CanopyOS inventory data for all four warehouses (**Vero Beach, Stuart, Orlando, Naples**) from the reconciled files in this folder, so that:

1. **Purchased:** every Aug and Sep 2026 supplier invoice line sits in the correct branch, at the correct date, quantity and cost.
2. **Disbursed:** every Aug and Sep 2026 warehouse-to-technician issue is recorded against the right tech and branch.
3. **On hand:** as of end of day 9/30/2026, every branch/product equals `06_expected_on_hand...csv`.
4. **Oct 1 count:** managers can enter a physical count dated 10/1/2026. It becomes the clean baseline.

The math, which the ledger must reproduce exactly:

> **On hand 9/30 = July 2026 count (as of 7/31) + Aug–Sep receipts − Aug–Sep tech issues**

---

## Files

| # | File | Rows | Becomes |
|---|---|---|---|
| 01 | `01_product_catalog.csv` | 115 | Product catalog: canonical name, category, unit cost, SiteOne item #s |
| 02 | `02_opening_balance_2026-07-31.csv` | 118 | `COUNT` movements dated 2026-07-31 |
| 03 | `03_receipts_2026-08_to_09.csv` | 407 | 351 `RECEIPT` movements, plus 56 `NON_INVENTORY` spend lines |
| 04 | `04_invoices_2026-08_to_09.csv` | 100 | Invoice / purchase-receipt headers (tax, freight, total, store) |
| 05 | `05_tech_issues_2026-08_to_09.csv` | 369 | `ISSUE_TO_TECH` movements |
| 06 | `06_expected_on_hand_2026-09-30_and_oct1_count_sheet.csv` | 203 | Verification target, and the Oct 1 count sheet |
| 07 | `07_supplier_store_to_branch.csv` | 9 | Store → branch lookup, used by all future invoice imports |
| 08 | `08_technician_roster_from_log.csv` | 35 | Tech names to match to employee records |
| 09 | `09_control_totals.csv` | 5 | Pass/fail numbers, per branch and total |

**Idempotency keys:**
- Opening balance (02): `external_ref`, in the form `JULY2026COUNT#branch#product`.
- Receipts (03): `external_ref`, in the form `invoice#line`.
- Tech issues (05): `external_ref`, in the form `branch#row<n>`.

Re-running the import must change nothing.

### Rules already applied in the data (don't re-derive)
- **Branch = supplier store** (file 07), not the ship-to. The ship-to is the Vero HQ address on most invoices.
- `inventory_units_received` = `qty_shipped` × `units_per_invoice_unit`:
  - Gentrol IGR: 1 box = 10 bottles.
  - Advion WDG: 1 packet = 0.2 of a 5-pack.
  - Helena: per-gal and per-lb billing converted to jugs and bags.
- **Credits and returns** are negative quantities. Import them as negative receipts.
- **`NON_INVENTORY` lines** (sprayers, PPE, pitchers, fuel surcharge, tonnage tax) count as purchase spend. They never touch stock.
- **Tech names** are normalized, e.g. Logan Coffee → Logan Coffey.

---

## Phase 0: Inspect and back up. STOP and report before deleting anything

1. Read the existing inventory schema and code: Product, ProductBarcode, BranchStock, Checkout/CheckoutLine, StockMovement, and any invoice/receipt tables.
2. Report current counts per branch: products, barcodes, StockMovements by type, BranchStock rows, checkouts.
3. Identify **live-app activity that must be preserved**:
   - any checkout or StockMovement created through the app on or after **2026-10-01**;
   - all ProductBarcode links;
   - all shelf-QR labels.
4. Back up every inventory table to `backup_inv_20261013_*` tables, or a pg_dump. Record the row counts.
5. **Print the reset plan and wait for Chris to reply "go".**

## Phase 1: Schema (only add what's missing)

- **Product:** add `vendorItemNumbers` (array or child table), `category`, `lastUnitCost`, `active`.
- **StockMovement:** must support types `COUNT | RECEIPT | ISSUE_TO_TECH | ISSUE_REVERSAL | ADJUSTMENT`. Required columns:
  - `branchId`, `productId`, `quantityDelta`, `movementDate`
  - `unitCost`, `technicianId` (nullable), `externalRef` (**unique**), `source`, `importBatchId`
- **PurchaseInvoice** (header) and **PurchaseInvoiceLine**:
  - Store all lines, including `NON_INVENTORY`, so purchase reports tie to invoice totals.
  - A `RECEIPT` StockMovement links to its invoice line.
- **SupplierStore → Branch** lookup table, seeded from file 07.
- **ImportBatch** table recording file name, row counts, timestamp, user.
- Run migrations against the **direct (non-pooled) `DATABASE_URL`**.

## Phase 2: Reset

All in one transaction per step where practical:

1. **Delete** these historical rows, dated **before 2026-10-01** only:
   - StockMovements, BranchStock, and imported invoice data;
   - any earlier seed/import of the Aug/Sep CSVs.

   Keep users, techs, branches, barcodes, labels, and post-10/1 app activity.
2. **Upsert the catalog** from file 01:
   - Match existing products by name or SiteOne item # so barcode links survive.
   - Report every match and every new product.
3. **Load opening balances** (02) as `COUNT` movements dated 2026-07-31.
4. **Load invoices and lines** (03 + 04). Write one `RECEIPT` movement per `RECEIPT` line:
   - date = `invoice_date`, qty = `inventory_units_received`, `unitCost` = `unit_cost`;
   - update Product `lastUnitCost` from the latest receipt.
5. **Load tech issues** (05) as `ISSUE_TO_TECH` (negative delta).
   - Match `technician` to employee records using file 08.
   - **Do not create users.** List unmatched names, and store the raw name on the movement.
   - Allow negative balances for this historical import only, flagged `needsCount`.
6. **Rebuild BranchStock** from the ledger (sum of movements through 9/30). Then re-apply any preserved post-10/1 app movements on top.

## Phase 3: Verify (must pass before reporting done)

Compare against `09_control_totals.csv` and print a pass/fail table:

| Check | Expected |
|---|---|
| Invoices imported | Vero 59 · Stuart 15 · Orlando 9 · Naples 17 = **100** |
| Purchases pre-tax | Vero $74,846.16 · Stuart $8,013.72 · Orlando $15,051.76 · Naples $8,395.72 = **$106,307.36** |
| Aug / Sep pre-tax | **$42,335.43 / $63,971.93** |
| RECEIPT movements / units | **351 / 2,630.6** |
| ISSUE_TO_TECH movements / units | **369 / 845** (Vero 604 · Stuart 49 · Orlando 186 · Naples 6) |
| Opening COUNT units | **832** (Vero 299 · Stuart 164 · Orlando 331 · Naples 38) |
| On hand 9/30 units | Vero 1,734 · Stuart 275 · Orlando 441.6 · Naples 167 = **2,617.6** |
| On hand 9/30 value | **$86,793.71** |
| Per-row check | BranchStock as of 9/30 = `expected_on_hand_10_1` for all **203** rows in file 06. **Zero mismatches.** |
| Negative balances | **18** rows (Vero 6, Stuart 5, Orlando 5, Naples 2), flagged |

Re-run the full import a second time and confirm that nothing changes.

## Phase 4: Screens & reports

1. **`/inventory/stock-count/2026-10-01`** (or extend the existing stock-count page). Per branch, show:
   - product, expected 10/1, flag, counted (input), variance units, variance $.
   - Submitting writes `COUNT` movements dated 2026-10-01 that reset BranchStock.
   - Add CSV export, plus CSV import of file 06 with `physical_count_10_1` filled in.
2. **`/inventory/reports`**, with month and branch filters and CSV export:
   - **Purchases by branch:** category, then product, then invoice. Totals must tie to invoice subtotals.
   - **Issued by technician:** tech, then product. Show units and est. value.
   - **On hand:** qty, value, last count date, flag.
   - **Count variance:** after Oct 1 counts are entered.
3. **Diagnostics.** Add the import batch (row counts, unmatched techs, mismatches, negatives) to `/api/inventory/diagnostics`, and bump the build tag.
4. **Deploy.** Commit to `main` and confirm the Vercel production deploy. Then report the build tag, the routes to test, and the Phase 3 pass/fail table.

---

## Known data gaps (show in the UI, never auto-"fix")

- **Naples:** the tech-issue log has **no entries after 8/1/2026**, against $8,396 purchased. Expected on-hand is overstated. Every Naples row is flagged.
- **Vero granular fertilizer** (25-0-10, 16-0-8, 8-0-10, 8-10-10) is never logged as issued. About 1,090 bags show as on hand. Flag these rows "count required".
- **18 negative balances.** Examples:
  - Orlando 24-0-11: −14
  - Stuart Optigard Ant Gel: −6
  - Vero Advion Evolution: −6
  - Orlando Invade Hot Spot: −5

  Causes: stock bought before the window, unlogged branch transfers, or a wrong product name in the log.
- **No July count:** Eaton Stick-Em, Pageant and Tekko Pro were issued but never bought or counted.
- **The July count sheet** was filled in around 7/20–7/27 and is treated as the 7/31 balance. About 100 log rows dated 7/20–7/31 are intentionally **not** imported.
- **Open invoices:**
  - Vero 170780458-001: $3,708.15
  - Naples 170762874-001: $1,463.07
  - Helena 269187362: $1,047.90

The Oct 1 physical count resolves all of these. After it, CanopyOS runs from the counted baseline plus live receipts and checkouts.
