// "Received stock surfaces the product" (COO 2026-11-23).
//
// If a product is logged in on an invoice, it must show up as a check-out option
// and in the catalog — never sit on hidden stock. The case that broke it: LESCO
// 16-0-8 Spar Tech (40 bags, Vero, invoice XFER-2026-11-04-VERO) was received onto
// a product row that had been taken OFF the catalog earlier (discarded from the
// Confirm Queue). The receipt posted the stock to that inactive row, so Purchases
// showed it while the check-out picker (active products only) and Catalog Admin
// (inactive hidden) did not.
//
// surfaceReceivedProducts() runs after any check-in posts stock. For each received
// product that is inactive (and isn't a merged-away duplicate) it:
//   - turns it back on (active) under its full catalog name,
//   - clears the discard / rejected-backlog markers so the deploy reconcile doesn't
//     switch it off again,
//   - routes it to a super admin (Julie) for approval:
//       on the approved catalog list → approved, unconfirmed → Confirm Queue
//       not on the list               → off-catalog, unconfirmed + a pending
//                                       product request (Inventory Admin → Requests)
// A product that is already approved + confirmed is left exactly as it is.
// It shows in the check-out picker immediately (badged "Not cataloged · request")
// and becomes dispensable once a super admin confirms / approves it — the
// "properly cataloged" check-out gate is unchanged.
//
// No "server-only" and no fs: used by the receipts core (runtime + CLI) and the
// in-app Check-In confirm route.
import type { PrismaClient } from "@prisma/client";
import { normalizeProductName } from "./product-aliases";
import { canonicalProductName } from "./catalog-names";
import { approvedCatalogShortNames, isHumanApproved } from "../prisma/seed-products-approved";

// Markers that keep a product off the catalog (must match the literals in
// app/api/products/confirm, lib/catalog-review.ts and lib/catalog-cleanup.ts).
const DISCARD_MARK = "Discarded from confirm queue";
const REJECTED_ARCHIVED_MARK = "Rejected backlog acknowledged";
export const RECEIVED_REACTIVATED_MARK = "Reactivated — received on invoice";

export type ReceivedContext = { distributor: string; invoiceNumber: string; warehouseName: string; date: string /* YYYY-MM-DD */ };

export type SurfacedProduct = { id: string; name: string; from: string; queue: "confirm" | "request" };

const isMerged = (p: { name: string; notes: string | null }) =>
  /\(merged\)\s*$/i.test(p.name) || (p.notes ?? "").includes("Merged into");

/** Strip the off-catalog sentences (discard / archived) from a notes string. */
function stripOffCatalogNotes(notes: string | null): string {
  return (notes ?? "")
    .replace(new RegExp(`${DISCARD_MARK}[^.]*(?:\\([^)]*\\))?[^.]*\\.\\s*`, "gi"), "")
    .replace(new RegExp(`${REJECTED_ARCHIVED_MARK}\\.?\\s*`, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();
}

let _catalogKeys: Set<string> | null = null;
/** True when a product name is on the approved catalog list (short or full name). */
export function isOnApprovedCatalogList(name: string): boolean {
  if (!_catalogKeys) {
    _catalogKeys = new Set();
    for (const s of approvedCatalogShortNames()) {
      _catalogKeys.add(normalizeProductName(s));
      _catalogKeys.add(normalizeProductName(canonicalProductName(s)));
    }
  }
  return _catalogKeys.has(normalizeProductName(name)) || _catalogKeys.has(normalizeProductName(canonicalProductName(name)));
}

export async function surfaceReceivedProducts(
  prisma: PrismaClient,
  productIds: string[],
  ctx: ReceivedContext,
): Promise<SurfacedProduct[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, active: false },
    select: { id: true, name: true, notes: true, approved: true, confirmed: true },
  });
  const out: SurfacedProduct[] = [];
  for (const p of products) {
    if (isMerged(p)) continue; // a merged-away twin: its stock belongs to the keeper

    // Show it under its full catalog description, unless another live row already
    // carries that name (then keep this row's name; a super admin can merge).
    const full = canonicalProductName(p.name);
    let name = p.name;
    if (full !== p.name) {
      const clash = await prisma.product.findFirst({ where: { name: full, active: true, NOT: { id: p.id } }, select: { id: true } });
      if (!clash) name = full;
    }

    const onList = isOnApprovedCatalogList(p.name);
    const humanOk = isHumanApproved(p.notes);
    // Already approved by a super admin in-app and still flagged approved+confirmed:
    // just turn it back on. Otherwise it waits on a super admin.
    const approved = onList || (humanOk && p.approved);
    const confirmed = humanOk && p.approved && p.confirmed;
    const queue: SurfacedProduct["queue"] = approved ? "confirm" : "request";
    const note = [
      stripOffCatalogNotes(p.notes),
      `${RECEIVED_REACTIVATED_MARK} ${ctx.invoiceNumber} (${ctx.distributor}, ${ctx.warehouseName}, ${ctx.date})` +
        (confirmed ? "." : " — needs super-admin approval before check-out."),
    ].filter(Boolean).join(" ");

    await prisma.product.update({ where: { id: p.id }, data: { active: true, name, approved, confirmed, notes: note } });

    if (!confirmed && queue === "request") {
      const open = await prisma.productRequest.findFirst({ where: { productId: p.id, status: "pending" }, select: { id: true } });
      if (!open) {
        const wh = await prisma.warehouse.findFirst({ where: { name: ctx.warehouseName }, select: { id: true } });
        await prisma.productRequest.create({
          data: {
            status: "pending",
            productId: p.id,
            proposedName: name,
            reason: `Received on ${ctx.distributor} invoice ${ctx.invoiceNumber} at ${ctx.warehouseName} — needs catalog approval before it can be checked out.`,
            onHandQty: null, // stock is already posted by the check_in — approval must never double-count
            warehouseId: wh?.id ?? null,
            requestedByUserId: "system", // soft field (no FK); no person raised it
            requestedByName: "Check-in (automatic)",
          },
        });
      }
    }
    if (!confirmed) out.push({ id: p.id, name, from: p.name, queue });
  }
  return out;
}

/** One-time repair for stock that was already received onto inactive products
 *  before this rule existed: every inactive, non-merged product holding positive
 *  on-hand that came in on an invoice is surfaced the same way. */
export async function surfaceHiddenReceivedStock(prisma: PrismaClient): Promise<SurfacedProduct[]> {
  const inactive = await prisma.product.findMany({ where: { active: false }, select: { id: true, name: true, notes: true } });
  const candidates = inactive.filter((p) => !isMerged(p));
  if (candidates.length === 0) return [];
  const sums = await prisma.stockMovement.groupBy({
    by: ["productId", "warehouseId"],
    where: { productId: { in: candidates.map((p) => p.id) } },
    _sum: { quantity: true },
  });
  const out: SurfacedProduct[] = [];
  for (const p of candidates) {
    const stocked = sums.filter((s) => s.productId === p.id && (s._sum.quantity ?? 0) > 1e-6);
    if (stocked.length === 0) continue;
    // Latest invoice this product was received on (for the note + request reason).
    const last = await prisma.stockMovement.findFirst({
      where: { productId: p.id, type: "check_in", sourceInvoiceId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { movementDate: true, createdAt: true, sourceInvoice: { select: { distributor: true, invoiceNumber: true, warehouse: { select: { name: true } } } } },
    });
    const inv = last?.sourceInvoice;
    if (!last || !inv) continue; // only stock that came in on an invoice
    out.push(
      ...(await surfaceReceivedProducts(prisma, [p.id], {
        distributor: inv.distributor,
        invoiceNumber: inv.invoiceNumber,
        warehouseName: inv.warehouse.name,
        date: (last.movementDate ?? last.createdAt).toISOString().slice(0, 10),
      })),
    );
  }
  return out;
}
