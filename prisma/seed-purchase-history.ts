import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HISTORY_BRANCHES,
  buildInvoices,
  buildProductIndex,
  type BranchConfig,
  type HistoryFile,
} from "../lib/purchase-history";

/**
 * Load the four PestPac transfer histories (prisma/data/purchase-history/*.json)
 * into Invoice + InvoiceLine as CONFIRMED, historical, analysis-only records.
 *
 * - NEVER creates a StockMovement — current on-hand is untouched (the CEO sets
 *   on-hand by a physical month-end count).
 * - Idempotent: skips any invoice whose deterministic "HIST-…" number already
 *   exists, so it is safe to run on every deploy.
 *
 * See lib/purchase-history.ts for the parser, resolver, and grouping logic.
 */

export type BranchLoadResult = {
  slug: string;
  warehouse: string;
  warehouseFound: boolean;
  receipts: number;
  invoicesCreated: number;
  invoicesSkipped: number;
  linesCreated: number;
  linesMatched: number;
  linesUnmatched: number;
  totalSpend: number;
  spendLoaded: number; // spend on invoices actually created this run
};

function readBranchFile(cfg: BranchConfig): HistoryFile {
  const path = join(process.cwd(), "prisma", "data", "purchase-history", cfg.file);
  return JSON.parse(readFileSync(path, "utf8")) as HistoryFile;
}

export async function loadBranchHistory(prisma: PrismaClient, cfg: BranchConfig): Promise<BranchLoadResult> {
  const file = readBranchFile(cfg);
  const warehouse = await prisma.warehouse.findFirst({ where: { name: cfg.warehouse } });

  const result: BranchLoadResult = {
    slug: cfg.slug,
    warehouse: cfg.warehouse,
    warehouseFound: !!warehouse,
    receipts: file.receipts.length,
    invoicesCreated: 0,
    invoicesSkipped: 0,
    linesCreated: 0,
    linesMatched: 0,
    linesUnmatched: 0,
    totalSpend: 0,
    spendLoaded: 0,
  };
  if (!warehouse) return result;

  const products = await prisma.product.findMany({ select: { id: true, name: true, distributorSku: true } });
  const idx = buildProductIndex(products);
  const invoices = buildInvoices(file, idx, cfg);
  result.totalSpend = invoices.reduce((s, inv) => s + inv.total, 0);

  for (const inv of invoices) {
    const existing = await prisma.invoice.findFirst({ where: { invoiceNumber: inv.invoiceNumber } });
    if (existing) {
      result.invoicesSkipped++;
      continue;
    }
    await prisma.invoice.create({
      data: {
        distributor: inv.distributor,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        warehouseId: warehouse.id,
        status: "confirmed",
        subtotal: inv.total,
        total: inv.total,
        lines: {
          create: inv.lines.map((l) => ({
            productId: l.productId,
            descriptionRaw: l.material,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            matched: !!l.productId,
          })),
        },
      },
    });
    result.invoicesCreated++;
    result.linesCreated += inv.lines.length;
    result.spendLoaded += inv.total;
    for (const l of inv.lines) {
      if (l.productId) result.linesMatched++;
      else result.linesUnmatched++;
    }
  }
  return result;
}

export async function loadPurchaseHistory(prisma: PrismaClient): Promise<BranchLoadResult[]> {
  const out: BranchLoadResult[] = [];
  for (const cfg of HISTORY_BRANCHES) {
    out.push(await loadBranchHistory(prisma, cfg));
  }
  return out;
}

// Allow running directly against local dev.db: `tsx prisma/seed-purchase-history.ts`
async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const before = await prisma.stockMovement.count();
    console.log(`purchase-history load: StockMovement count BEFORE = ${before}`);
    const results = await loadPurchaseHistory(prisma);
    let grand = 0;
    for (const r of results) {
      grand += r.totalSpend;
      console.log(
        `  ${r.warehouse}: ${r.receipts} receipts, ${r.invoicesCreated} invoices created (${r.invoicesSkipped} skipped), ` +
          `${r.linesMatched} matched / ${r.linesUnmatched} unmatched lines, total spend $${r.totalSpend.toFixed(2)}` +
          (r.warehouseFound ? "" : "  [WAREHOUSE NOT FOUND]")
      );
    }
    console.log(`  GRAND TOTAL spend across 4 branches: $${grand.toFixed(2)}`);
    const after = await prisma.stockMovement.count();
    console.log(`purchase-history load: StockMovement count AFTER = ${after}  (${after === before ? "UNCHANGED ✓" : "CHANGED ✗"})`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /seed-purchase-history\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
