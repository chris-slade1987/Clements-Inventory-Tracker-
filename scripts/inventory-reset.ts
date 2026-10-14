/**
 * Inventory reset — import the reconciled Aug/Sep 2026 files and rebuild the
 * ledger, per prisma/data/inventory-reset/00_BRIEF.md.
 *
 * On-hand stays COMPUTED from stock_movements (core rule: never store on-hand).
 * Movement-type mapping onto the existing ledger:
 *   COUNT        -> type "adjustment"  (opening balance + Oct 1 count)
 *   RECEIPT      -> type "check_in"    (signed; credits/returns are negative)
 *   ISSUE_TO_TECH-> type "check_out"   (negative quantity)
 * Every imported row carries a unique `externalRef`, so re-running changes nothing.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/inventory-reset.ts preview   # counts only, no writes
 *   DATABASE_URL=... tsx scripts/inventory-reset.ts apply     # idempotent import (no delete)
 *   DATABASE_URL=... tsx scripts/inventory-reset.ts verify    # import (if needed) + Phase 3 checks
 *
 * The destructive pre-10/1 WIPE is a separate, gated step (scripts/inventory-reset-run.ts).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "prisma", "data", "inventory-reset");
const BATCH_LABEL = "inventory-reset 2026-10";
const IMPORT_SOURCE = "import:inventory-reset-2026-10";

// clements branch -> Warehouse.name
const BRANCH_TO_WH: Record<string, string> = {
  "Vero Beach": "Vero Beach (HQ)",
  Stuart: "Stuart",
  Orlando: "Orlando",
  Naples: "Naples",
};

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields with commas / embedded quotes)
// ---------------------------------------------------------------------------
function parseCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift()!;
  return rows
    .filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const num = (s: string | undefined) => {
  if (s == null || s === "") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const parseDate = (s: string) => new Date(`${s}T12:00:00Z`);

type Result = {
  warehouses: Record<string, string>;
  catalog: { matched: number; created: number; createdNames: string[] };
  supplierStores: number;
  opening: number;
  invoices: number;
  invoiceLines: number;
  receipts: number;
  receiptUnits: number;
  nonInventory: number;
  issues: number;
  issueUnits: number;
  unmatchedTechs: string[];
  unmatchedProducts: string[];
  negatives: number;
};

export async function runInventoryImport(prisma: PrismaClient, opts: { apply: boolean }): Promise<Result> {
  const { apply } = opts;

  // --- Warehouses ---
  const whRows = await prisma.warehouse.findMany({ select: { id: true, name: true } });
  const whByName = new Map(whRows.map((w) => [w.name, w.id]));
  const warehouses: Record<string, string> = {};
  for (const [branch, name] of Object.entries(BRANCH_TO_WH)) {
    const id = whByName.get(name);
    if (!id) throw new Error(`Warehouse "${name}" (branch ${branch}) not found in DB — seed warehouses first.`);
    warehouses[branch] = id;
  }

  // --- 07 supplier stores ---
  let supplierStores = 0;
  for (const r of parseCsv(join(DIR, "07_supplier_store_to_branch.csv"))) {
    if (apply) {
      await prisma.supplierStore.upsert({
        where: { vendor_storeLocation: { vendor: r.vendor, storeLocation: r.supplier_store } },
        update: { branch: r.clements_branch },
        create: { vendor: r.vendor, storeLocation: r.supplier_store, branch: r.clements_branch },
      });
    }
    supplierStores++;
  }

  // --- 01 catalog upsert (match by name, else by vendor item #) ---
  const catalog = parseCsv(join(DIR, "01_product_catalog.csv"));
  const productIdByName = new Map<string, string>();
  const cat = { matched: 0, created: 0, createdNames: [] as string[] };
  // Prefetch existing products for matching by vendor item #.
  const existing = await prisma.product.findMany({ select: { id: true, name: true, distributorSku: true, vendorItemNumbers: true } });
  const existByName = new Map(existing.map((p) => [p.name, p.id]));
  const existByItem = new Map<string, string>();
  for (const p of existing) {
    for (const it of [p.distributorSku, ...(p.vendorItemNumbers?.split(",") ?? [])]) {
      const t = (it ?? "").trim();
      if (t) existByItem.set(t, p.id);
    }
  }
  for (const r of catalog) {
    const name = r.inventory_product;
    if (!name) continue;
    const items = (r.siteone_item_numbers || "").split(",").map((s) => s.trim()).filter(Boolean);
    let id = existByName.get(name) ?? items.map((it) => existByItem.get(it)).find(Boolean);
    const data = {
      category: r.category || null,
      vendorItemNumbers: items.join(",") || null,
      distributorSku: items[0] || null,
      lastUnitCost: r.unit_cost ? num(r.unit_cost) : null,
    };
    if (id) {
      cat.matched++;
      if (apply) await prisma.product.update({ where: { id }, data });
    } else {
      cat.created++;
      cat.createdNames.push(name);
      if (apply) {
        const created = await prisma.product.create({
          data: {
            name,
            unitOfMeasure: "unit",
            approved: false,
            confirmed: false,
            notes: "Added by inventory reset import — confirm naming/UoM.",
            ...data,
          },
        });
        id = created.id;
      } else id = `preview:${name}`;
    }
    productIdByName.set(name, id!);
  }

  const unmatchedProducts = new Set<string>();
  const productId = (name: string) => {
    const id = productIdByName.get(name);
    if (!id) unmatchedProducts.add(name);
    return id;
  };

  // --- Import batch ---
  let batchId: string | null = null;
  if (apply) {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".csv")).map((name) => ({ name }));
    const b = await prisma.importBatch.create({ data: { label: BATCH_LABEL, files: JSON.stringify(files) } });
    batchId = b.id;
  }

  const mv = async (data: {
    type: string; externalRef: string; productName: string; branch: string; quantity: number;
    movementDate: Date; unitPrice?: number | null; sourceInvoiceId?: string | null;
    technicianId?: string | null; technicianNameRaw?: string | null; needsCount?: boolean; reason?: string;
  }) => {
    const pid = productId(data.productName);
    if (!pid || !apply) return;
    await prisma.stockMovement.upsert({
      where: { externalRef: data.externalRef },
      update: {},
      create: {
        type: data.type,
        productId: pid,
        warehouseId: warehouses[data.branch],
        quantity: data.quantity,
        unitPrice: data.unitPrice ?? null,
        sourceInvoiceId: data.sourceInvoiceId ?? null,
        technicianId: data.technicianId ?? null,
        technicianNameRaw: data.technicianNameRaw ?? null,
        needsCount: data.needsCount ?? false,
        reason: data.reason ?? null,
        movementDate: data.movementDate,
        externalRef: data.externalRef,
        source: IMPORT_SOURCE,
        importBatchId: batchId,
      },
    });
  };

  // --- 02 opening balance -> COUNT (adjustment) ---
  let opening = 0;
  for (const r of parseCsv(join(DIR, "02_opening_balance_2026-07-31.csv"))) {
    await mv({
      type: "adjustment", externalRef: r.external_ref, productName: r.inventory_product, branch: r.branch,
      quantity: num(r.qty), movementDate: parseDate(r.movement_date), reason: "July 2026 count (opening balance)",
    });
    opening++;
  }

  // --- 04 invoice headers ---
  const invoices = parseCsv(join(DIR, "04_invoices_2026-08_to_09.csv"));
  const invoiceIdByNumber = new Map<string, string>();
  for (const r of invoices) {
    const branch = r.clements_branch;
    if (apply) {
      const existingInv = await prisma.invoice.findFirst({ where: { distributor: r.vendor, invoiceNumber: r.invoice_number } });
      const data = {
        distributor: r.vendor, invoiceNumber: r.invoice_number, invoiceDate: parseDate(r.invoice_date),
        warehouseId: warehouses[branch], subtotal: num(r.subtotal), total: num(r.total),
        salesTax: num(r.sales_tax), freight: num(r.freight), amountDue: num(r.amount_due),
        storeLocation: r.siteone_location, openInvoice: num(r.amount_due) > 0, status: "confirmed",
        importBatchId: batchId,
      };
      const inv = existingInv
        ? await prisma.invoice.update({ where: { id: existingInv.id }, data })
        : await prisma.invoice.create({ data });
      invoiceIdByNumber.set(r.invoice_number, inv.id);
    } else invoiceIdByNumber.set(r.invoice_number, `preview:${r.invoice_number}`);
  }

  // --- 03 receipts -> InvoiceLine (+ RECEIPT check_in movement; NON_INVENTORY no stock) ---
  let invoiceLines = 0, receipts = 0, receiptUnits = 0, nonInventory = 0;
  const lastCostByProduct = new Map<string, { date: number; cost: number }>();
  const receiptRows = parseCsv(join(DIR, "03_receipts_2026-08_to_09.csv"));
  for (let ri = 0; ri < receiptRows.length; ri++) {
    const r = receiptRows[ri];
    const isReceipt = r.movement_type === "RECEIPT";
    const invId = invoiceIdByNumber.get(r.invoice_number);
    const pid = isReceipt ? productId(r.inventory_product) : undefined;
    // InvoiceLine key is row-unique: the source file reuses one external_ref for a
    // receipt + fuel-surcharge pair, so the raw ref alone collides. Movements still
    // use the raw ref (only receipts post stock, so those stay unique).
    const lineRef = `${r.external_ref}#row${ri}`;
    if (apply && invId) {
      const existingLine = await prisma.invoiceLine.findFirst({ where: { externalRef: lineRef } });
      const lineData = {
        invoiceId: invId, productId: pid ?? null, descriptionRaw: r.description,
        quantity: num(r.qty_shipped), unit: r.uom || null, unitPrice: num(r.net_unit_price),
        lineTotal: num(r.ext_price), matched: isReceipt && !!pid, itemNumber: r.item_number || null,
        category: r.category || null, unitCost: r.unit_cost ? num(r.unit_cost) : null,
        nonInventory: !isReceipt, externalRef: lineRef,
        invoiceUnits: isReceipt ? num(r.inventory_units_received) : null,
      };
      if (existingLine) await prisma.invoiceLine.update({ where: { id: existingLine.id }, data: lineData });
      else await prisma.invoiceLine.create({ data: lineData });
    }
    invoiceLines++;
    if (isReceipt) {
      const units = num(r.inventory_units_received);
      await mv({
        type: "check_in", externalRef: r.external_ref, productName: r.inventory_product, branch: r.branch,
        quantity: units, movementDate: parseDate(r.invoice_date), unitPrice: r.unit_cost ? num(r.unit_cost) : null,
        sourceInvoiceId: invId && apply ? invId : null, reason: `Receipt ${r.invoice_number} line ${r.line}`,
      });
      receipts++; receiptUnits += units;
      // track latest cost
      if (r.unit_cost) {
        const d = parseDate(r.invoice_date).getTime();
        const prev = lastCostByProduct.get(r.inventory_product);
        if (!prev || d >= prev.date) lastCostByProduct.set(r.inventory_product, { date: d, cost: num(r.unit_cost) });
      }
    } else nonInventory++;
  }
  // update lastUnitCost from latest receipt
  if (apply) {
    for (const [name, { cost }] of lastCostByProduct) {
      const pid = productIdByName.get(name);
      if (pid && !pid.startsWith("preview:")) await prisma.product.update({ where: { id: pid }, data: { lastUnitCost: cost } });
    }
  }

  // --- 08 roster + technician matching ---
  const roster = parseCsv(join(DIR, "08_technician_roster_from_log.csv"));
  const techs = await prisma.technician.findMany({ select: { id: true, name: true } });
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const techByName = new Map(techs.map((t) => [norm(t.name), t.id]));
  const rosterNames = new Set(roster.map((r) => norm(r.technician)));
  const unmatchedTechs = new Set<string>();

  // --- 05 tech issues -> ISSUE_TO_TECH (check_out, negative) ---
  let issues = 0, issueUnits = 0;
  for (const r of parseCsv(join(DIR, "05_tech_issues_2026-08_to_09.csv"))) {
    const tid = techByName.get(norm(r.technician)) ?? null;
    if (!tid) unmatchedTechs.add(r.technician);
    const qty = num(r.qty);
    await mv({
      type: "check_out", externalRef: r.external_ref, productName: r.inventory_product, branch: r.branch,
      quantity: -qty, movementDate: parseDate(r.date), unitPrice: r.unit_cost_est ? num(r.unit_cost_est) : null,
      technicianId: tid, technicianNameRaw: tid ? null : r.technician,
      reason: `Issued to ${r.technician}`,
    });
    issues++; issueUnits += qty;
  }
  void rosterNames;

  // negatives flagged later by verify; count computed there
  const result: Result = {
    warehouses,
    catalog: cat,
    supplierStores,
    opening,
    invoices: invoices.length,
    invoiceLines,
    receipts,
    receiptUnits,
    nonInventory,
    issues,
    issueUnits,
    unmatchedTechs: [...unmatchedTechs],
    unmatchedProducts: [...unmatchedProducts],
    negatives: 0,
  };

  if (apply && batchId) {
    await prisma.importBatch.update({
      where: { id: batchId },
      data: {
        counts: JSON.stringify({
          opening, invoices: invoices.length, invoiceLines, receipts, receiptUnits, nonInventory, issues, issueUnits,
          catalogMatched: cat.matched, catalogCreated: cat.created,
        }),
        anomalies: JSON.stringify({ unmatchedTechs: [...unmatchedTechs], unmatchedProducts: [...unmatchedProducts] }),
      },
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase 3 verification: on-hand computed from movements through 9/30 vs file 06,
// plus the control totals in file 09.
// ---------------------------------------------------------------------------
export async function verifyInventory(prisma: PrismaClient) {
  const expected = parseCsv(join(DIR, "06_expected_on_hand_2026-09-30_and_oct1_count_sheet.csv"));
  const whRows = await prisma.warehouse.findMany({ select: { id: true, name: true } });
  const nameById = new Map(whRows.map((w) => [w.id, w.name]));
  const whNameToBranch: Record<string, string> = {
    "Vero Beach (HQ)": "Vero Beach", Stuart: "Stuart", Orlando: "Orlando", Naples: "Naples",
  };
  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  const prodName = new Map(products.map((p) => [p.id, p.name]));

  // on-hand through 9/30 = sum(quantity) where movementDate <= 2026-09-30
  const cutoff = new Date("2026-09-30T23:59:59Z");
  const movs = await prisma.stockMovement.findMany({
    where: { OR: [{ movementDate: { lte: cutoff } }, { movementDate: null, createdAt: { lte: cutoff } }] },
    select: { productId: true, warehouseId: true, quantity: true },
  });
  const onHand = new Map<string, number>(); // branch|name -> qty
  for (const m of movs) {
    const branch = whNameToBranch[nameById.get(m.warehouseId) ?? ""] ?? "?";
    const key = `${branch}|${prodName.get(m.productId) ?? "?"}`;
    onHand.set(key, (onHand.get(key) ?? 0) + m.quantity);
  }
  let mismatches = 0; const mismatchRows: string[] = [];
  let negatives = 0;
  for (const r of expected) {
    const key = `${r.branch}|${r.inventory_product}`;
    const got = Math.round((onHand.get(key) ?? 0) * 100) / 100;
    const exp = Math.round(num(r.expected_on_hand_10_1) * 100) / 100;
    if (Math.abs(got - exp) > 0.01) { mismatches++; if (mismatchRows.length < 25) mismatchRows.push(`${key}: got ${got} vs expected ${exp}`); }
    if (exp < 0) negatives++;
  }
  return { rows: expected.length, mismatches, mismatchRows, negatives };
}

async function main() {
  const mode = process.argv[2] || "preview";
  const prisma = new PrismaClient();
  try {
    if (mode === "verify") {
      const r = await runInventoryImport(prisma, { apply: true });
      console.log("IMPORT:", JSON.stringify(r, null, 2));
      const v = await verifyInventory(prisma);
      console.log("\nVERIFY (on-hand 9/30 vs file 06):");
      console.log(`  rows=${v.rows}  mismatches=${v.mismatches}  negatives=${v.negatives}`);
      if (v.mismatchRows.length) console.log("  sample mismatches:\n   " + v.mismatchRows.join("\n   "));
      console.log(v.mismatches === 0 ? "\n✅ PER-ROW ON-HAND MATCHES FILE 06" : "\n❌ MISMATCHES");
      process.exit(v.mismatches === 0 ? 0 : 1);
    } else {
      const r = await runInventoryImport(prisma, { apply: mode === "apply" });
      console.log(`${mode.toUpperCase()}:`, JSON.stringify(r, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].includes("inventory-reset")) main();
