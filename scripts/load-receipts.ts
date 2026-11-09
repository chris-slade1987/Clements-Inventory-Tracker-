/**
 * Load distributor receipts reported from PestPac transfer exports
 * (prisma/data/receipts/*.json) as CONFIRMED invoices with positive check_in
 * movements — the same records a manager's in-app Check-In creates, so on-hand
 * (SUM of movements) and the Purchases report pick them up.
 *
 * - Products resolve exactly like the verified 10/30 on-hand baseline: catalog
 *   name first, then the PestPac alias map (lib/product-aliases.ts). A material
 *   that doesn't resolve is REPORTED and skipped — never invented.
 * - Idempotent: each line carries a fixed externalRef (unique on InvoiceLine and
 *   StockMovement), and the invoice is found by distributor + invoice number, so
 *   re-running posts nothing twice.
 * - Never edits or deletes existing movements (append-only ledger).
 *
 * Usage: tsx scripts/load-receipts.ts [--apply]   (dry run without --apply)
 * Also called from scripts/deploy-db.ts on production deploys.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { normalizeProductName, PRODUCT_ALIASES } from "../lib/product-aliases";

type ReceiptFile = {
  key: string;
  distributor: string;
  invoiceNumber: string;
  date: string; // YYYY-MM-DD
  warehouse: string;
  transferredBy?: string;
  lines: { material: string; quantity: number; unitRaw?: string; cost: number }[];
};

export type LoadReceiptsResult = {
  files: { key: string; warehouse: string; posted: number; skippedExisting: number; unmatched: string[] }[];
};

export async function loadReceipts(prisma: PrismaClient, opts: { apply: boolean }): Promise<LoadReceiptsResult> {
  const dir = join(process.cwd(), "prisma", "data", "receipts");
  let names: string[] = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return { files: [] }; }

  const products = await prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, unitOfMeasure: true } });
  const byNorm = new Map(products.map((p) => [normalizeProductName(p.name), p]));
  const resolve = (material: string) => {
    const norm = normalizeProductName(material);
    const direct = byNorm.get(norm);
    if (direct) return direct;
    const aliased = PRODUCT_ALIASES[norm];
    return aliased ? byNorm.get(normalizeProductName(aliased)) ?? null : null;
  };

  const out: LoadReceiptsResult = { files: [] };
  for (const name of names) {
    const f = JSON.parse(readFileSync(join(dir, name), "utf8")) as ReceiptFile;
    const res = { key: f.key, warehouse: f.warehouse, posted: 0, skippedExisting: 0, unmatched: [] as string[] };
    const wh = await prisma.warehouse.findFirst({ where: { name: f.warehouse }, select: { id: true, name: true } });
    if (!wh) { res.unmatched.push(`warehouse "${f.warehouse}" not found`); out.files.push(res); continue; }

    const date = new Date(`${f.date}T12:00:00Z`); // noon UTC so the ET calendar day is right
    const resolved = f.lines.map((l, i) => ({ l, i, prod: resolve(l.material), ref: `${f.key}#${i + 1}` }));
    for (const r of resolved) if (!r.prod) res.unmatched.push(r.l.material);
    const toPost = resolved.filter((r) => r.prod);

    if (!opts.apply) { res.posted = toPost.length; out.files.push(res); continue; }

    await prisma.$transaction(async (tx) => {
      let invoice = await tx.invoice.findFirst({ where: { distributor: f.distributor, invoiceNumber: f.invoiceNumber, warehouseId: wh.id } });
      if (!invoice) {
        const total = Math.round(toPost.reduce((s, r) => s + r.l.cost, 0) * 100) / 100;
        invoice = await tx.invoice.create({
          data: { distributor: f.distributor, invoiceNumber: f.invoiceNumber, invoiceDate: date, warehouseId: wh.id, subtotal: total, total, status: "confirmed" },
        });
      }
      for (const r of toPost) {
        const prod = r.prod!;
        if (await tx.stockMovement.findUnique({ where: { externalRef: r.ref } })) { res.skippedExisting++; continue; }
        const unitPrice = r.l.quantity ? Math.round((r.l.cost / r.l.quantity) * 1000) / 1000 : null;
        const unit = prod.unitOfMeasure ?? null;
        await tx.invoiceLine.create({
          data: {
            invoiceId: invoice.id, productId: prod.id, descriptionRaw: r.l.material, quantity: r.l.quantity,
            unit: r.l.unitRaw ?? unit, unitPrice, lineTotal: r.l.cost, matched: true, unitCost: unitPrice,
            externalRef: r.ref, invoiceUnits: r.l.quantity,
          },
        });
        await tx.stockMovement.create({
          data: {
            type: "check_in", productId: prod.id, warehouseId: wh.id, quantity: r.l.quantity, unit, unitPrice,
            sourceInvoiceId: invoice.id, movementDate: date, externalRef: r.ref, source: "pestpac_transfer",
            reason: `Received from ${f.distributor} ${f.date}${f.transferredBy ? ` (transferred by ${f.transferredBy})` : ""} — PestPac transfer report`,
          },
        });
        if (unitPrice != null) await tx.product.update({ where: { id: prod.id }, data: { lastUnitCost: unitPrice } });
        res.posted++;
      }
    });
    out.files.push(res);
  }
  return out;
}

// CLI
if (require.main === module) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await loadReceipts(prisma, { apply: process.argv.includes("--apply") });
      console.log(JSON.stringify(r, null, 2));
    } finally { await prisma.$disconnect(); }
  })();
}
