// Shared core for loading distributor receipts reported from PestPac transfer
// exports (prisma/data/receipts/*.json) as CONFIRMED invoices + positive check_in
// movements — the same records an in-app Check-In writes, so on-hand (SUM of
// movements) and the Purchases report include them.
//
// No "server-only" and no fs here: used by both the runtime healer
// (lib/receipts-ensure.ts — production only accepts runtime writes) and the CLI
// (scripts/load-receipts.ts).
//
// Matching mirrors the verified 10/30 on-hand baseline (lib/onhand-baseline.ts):
// every product (approved preferred when two normalize alike); the PestPac alias
// map is consulted FIRST (it is the authority for PestPac material names), then a
// direct name match. Unmatched lines are reported, never invented.
//
// Idempotent without a transaction (so a slow database can't time it out half way):
// the invoice has a fixed id per file, and each line has a fixed externalRef that is
// unique on both InvoiceLine and StockMovement.
import type { PrismaClient } from "@prisma/client";
import { normalizeProductName, PRODUCT_ALIASES } from "./product-aliases";

export type ReceiptFile = {
  key: string;
  distributor: string;
  invoiceNumber: string;
  date: string; // YYYY-MM-DD
  warehouse: string;
  transferredBy?: string;
  /** `remove` (a reason) = never post this line; if it was already posted, reverse it
   *  (removeReceiptLines). The line stays in the file so every other line keeps its
   *  position-based externalRef. */
  lines: { material: string; quantity: number; unitRaw?: string; cost: number; remove?: string }[];
};

export type ReceiptFileResult = {
  key: string;
  warehouse: string;
  ready: boolean; // false = prerequisites (warehouse / catalog) missing — retry later
  posted: number;
  skippedExisting: number;
  unmatched: string[];
  /** Lines skipped because the same product + quantity was already received at this
   *  warehouse within a few days (e.g. through the in-app Check-In) — never double-post. */
  alreadyReceived: string[];
  detail: { material: string; product: string | null; quantity: number }[];
};

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";

export async function applyReceiptFile(prisma: PrismaClient, f: ReceiptFile, opts: { apply: boolean }): Promise<ReceiptFileResult> {
  const res: ReceiptFileResult = { key: f.key, warehouse: f.warehouse, ready: false, posted: 0, skippedExisting: 0, unmatched: [], alreadyReceived: [], detail: [] };

  const wh = await prisma.warehouse.findFirst({ where: { name: f.warehouse }, select: { id: true } });
  if (!wh) return res;
  const products = await prisma.product.findMany({ select: { id: true, name: true, approved: true, unitOfMeasure: true } });
  if (products.length === 0) return res;
  res.ready = true;

  const byNorm = new Map<string, (typeof products)[number]>();
  for (const p of products) {
    const n = normalizeProductName(p.name);
    const prev = byNorm.get(n);
    if (!prev || (!prev.approved && p.approved)) byNorm.set(n, p);
  }
  const resolve = (material: string) => {
    const norm = normalizeProductName(material);
    const aliased = PRODUCT_ALIASES[norm];
    if (aliased) {
      const hit = byNorm.get(normalizeProductName(aliased));
      if (hit) return hit;
    }
    return byNorm.get(norm) ?? null;
  };

  const date = new Date(`${f.date}T12:00:00Z`); // noon UTC → correct ET calendar day
  const lines = f.lines
    .map((l, i) => ({ l, prod: resolve(l.material), ref: `${f.key}#${i + 1}` }))
    .filter((r) => !r.l.remove);
  for (const r of lines) {
    res.detail.push({ material: r.l.material, product: r.prod?.name ?? null, quantity: r.l.quantity });
    if (!r.prod) res.unmatched.push(r.l.material);
  }
  const toPost = lines.filter((r) => r.prod);
  if (!opts.apply) {
    res.posted = toPost.length;
    return res;
  }

  // Invoice: fixed id per file so concurrent runs can't create two.
  const invoiceId = `rcpt-${f.key}`;
  const total = Math.round(toPost.reduce((s, r) => s + r.l.cost, 0) * 100) / 100;
  const existingInv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!existingInv) {
    await prisma.invoice
      .create({
        data: { id: invoiceId, distributor: f.distributor, invoiceNumber: f.invoiceNumber, invoiceDate: date, warehouseId: wh.id, subtotal: total, total, status: "confirmed" },
      })
      .catch((e) => { if (!isUniqueViolation(e)) throw e; });
  }

  for (const r of toPost) {
    const prod = r.prod!;
    if (await prisma.stockMovement.findUnique({ where: { externalRef: r.ref }, select: { id: true } })) {
      res.skippedExisting++;
      continue;
    }
    // Guard: the same product + quantity already received at this warehouse within
    // a few days on a DIFFERENT invoice (e.g. a manager's in-app Check-In of the same
    // shipment) → skip and report it rather than double the stock.
    const DAY = 864e5;
    const dup = await prisma.invoiceLine.findFirst({
      where: {
        productId: prod.id,
        quantity: r.l.quantity,
        invoiceId: { not: invoiceId },
        invoice: { warehouseId: wh.id, status: "confirmed", invoiceDate: { gte: new Date(date.getTime() - 3 * DAY), lte: new Date(date.getTime() + 7 * DAY) } },
      },
      select: { id: true, invoice: { select: { invoiceNumber: true } } },
    });
    if (dup) {
      res.alreadyReceived.push(`${r.l.material} ×${r.l.quantity} (already on invoice ${dup.invoice.invoiceNumber})`);
      continue;
    }
    const unitPrice = r.l.quantity ? Math.round((r.l.cost / r.l.quantity) * 1000) / 1000 : null;
    const unit = prod.unitOfMeasure ?? null;
    if (!(await prisma.invoiceLine.findUnique({ where: { externalRef: r.ref }, select: { id: true } }))) {
      await prisma.invoiceLine
        .create({
          data: {
            invoiceId, productId: prod.id, descriptionRaw: r.l.material, quantity: r.l.quantity, unit: r.l.unitRaw ?? unit,
            unitPrice, lineTotal: r.l.cost, matched: true, unitCost: unitPrice, externalRef: r.ref, invoiceUnits: r.l.quantity,
          },
        })
        .catch((e) => { if (!isUniqueViolation(e)) throw e; });
    }
    try {
      await prisma.stockMovement.create({
        data: {
          type: "check_in", productId: prod.id, warehouseId: wh.id, quantity: r.l.quantity, unit, unitPrice,
          sourceInvoiceId: invoiceId, movementDate: date, externalRef: r.ref, source: "pestpac_transfer",
          reason: `Received from ${f.distributor} ${f.date}${f.transferredBy ? ` (transferred by ${f.transferredBy})` : ""} — PestPac transfer report`,
        },
      });
      res.posted++;
    } catch (e) {
      if (isUniqueViolation(e)) { res.skippedExisting++; continue; }
      throw e;
    }
    if (unitPrice != null) await prisma.product.update({ where: { id: prod.id }, data: { lastUnitCost: unitPrice } }).catch(() => {});
  }
  return res;
}

/** Reverse lines flagged `remove` that were already posted: an offsetting negative
 *  `adjustment` (reversalOfId → the original check_in, same movement date) so on-hand
 *  nets out with the audit trail kept, then the invoice line comes off the receipt and
 *  the invoice total is recomputed so Purchases no longer shows it. Movements are never
 *  deleted. Idempotent (reversalOfId is unique). Returns how many lines it reversed. */
export async function removeReceiptLines(prisma: PrismaClient, f: ReceiptFile): Promise<number> {
  let n = 0;
  const invoiceId = `rcpt-${f.key}`;
  for (const [i, l] of f.lines.entries()) {
    if (!l.remove) continue;
    const ref = `${f.key}#${i + 1}`;
    const mv = await prisma.stockMovement.findUnique({ where: { externalRef: ref } });
    if (mv && !(await prisma.stockMovement.findUnique({ where: { reversalOfId: mv.id }, select: { id: true } }))) {
      try {
        await prisma.stockMovement.create({
          data: {
            type: "adjustment", productId: mv.productId, warehouseId: mv.warehouseId, quantity: -mv.quantity,
            unit: mv.unit, unitPrice: mv.unitPrice, movementDate: mv.movementDate, reversalOfId: mv.id,
            reason: `Receipt line removed (${f.invoiceNumber}: ${l.material}) — ${l.remove}`,
          },
        });
        n++;
      } catch (e) { if (!isUniqueViolation(e)) throw e; }
    }
    await prisma.invoiceLine.deleteMany({ where: { externalRef: ref } });
  }
  if (n > 0 || f.lines.some((l) => l.remove)) {
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
    if (inv) {
      const agg = await prisma.invoiceLine.aggregate({ where: { invoiceId }, _sum: { lineTotal: true } });
      const total = Math.round((agg._sum.lineTotal ?? 0) * 100) / 100;
      await prisma.invoice.update({ where: { id: invoiceId }, data: { subtotal: total, total } });
    }
  }
  return n;
}
