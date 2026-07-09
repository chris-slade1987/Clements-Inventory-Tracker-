import { prisma } from "@/lib/prisma";

// The anomaly agent. Runs on invoice confirm and on demand ("run checks now").
// It upserts alerts keyed by a stable dedupeKey so repeated runs don't pile up
// duplicates, and it respects a user's dismissal (upsert never changes status).

const DEFAULT_THRESHOLD_PCT = 10;
const SPIKE_FACTOR = 3; // flag check-outs > this many times the typical qty
const SPIKE_MIN_SAMPLES = 3;

export type AnomalySummary = {
  price_increase: number;
  duplicate_invoice: number;
  negative_stock: number;
  quantity_spike: number;
};

async function getThresholdPct(): Promise<number> {
  const s = await prisma.setting.findUnique({
    where: { key: "price_increase_threshold_pct" },
  });
  const n = s ? Number(s.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_PCT;
}

async function raise(
  dedupeKey: string,
  data: {
    type: string;
    productId?: string | null;
    message: string;
    severity: "info" | "warning" | "critical";
  }
) {
  await prisma.alert.upsert({
    where: { dedupeKey },
    create: {
      dedupeKey,
      type: data.type,
      productId: data.productId ?? null,
      message: data.message,
      severity: data.severity,
      status: "open",
    },
    // Refresh wording/severity but never override the user's status choice.
    update: { message: data.message, severity: data.severity },
  });
}

export async function runAnomalyChecks(): Promise<AnomalySummary> {
  const summary: AnomalySummary = {
    price_increase: 0,
    duplicate_invoice: 0,
    negative_stock: 0,
    quantity_spike: 0,
  };

  // ---- price_increase --------------------------------------------------
  const thresholdPct = await getThresholdPct();
  const priced = await prisma.invoiceLine.findMany({
    where: {
      productId: { not: null },
      unitPrice: { not: null },
      invoice: { status: "confirmed" },
    },
    select: {
      id: true,
      productId: true,
      unitPrice: true,
      product: { select: { name: true } },
      invoice: { select: { distributor: true, invoiceDate: true, invoiceNumber: true } },
    },
  });
  // Group by product+distributor, ordered by invoice date.
  const groups = new Map<string, typeof priced>();
  for (const l of priced) {
    const key = `${l.productId}::${l.invoice.distributor}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  for (const list of groups.values()) {
    const sorted = [...list].sort(
      (a, b) => a.invoice.invoiceDate.getTime() - b.invoice.invoiceDate.getTime()
    );
    const prior: number[] = [];
    for (const l of sorted) {
      const price = l.unitPrice!;
      if (prior.length > 0) {
        const avg = prior.reduce((s, x) => s + x, 0) / prior.length;
        if (avg > 0 && price > avg * (1 + thresholdPct / 100)) {
          const pctUp = Math.round(((price - avg) / avg) * 100);
          await raise(`price_increase:${l.id}`, {
            type: "price_increase",
            productId: l.productId,
            severity: pctUp >= 25 ? "critical" : "warning",
            message: `${l.product?.name ?? "Product"} up ${pctUp}% on ${l.invoice.distributor} invoice ${l.invoice.invoiceNumber} ($${price.toFixed(2)} vs avg $${avg.toFixed(2)}).`,
          });
          summary.price_increase++;
        }
      }
      prior.push(price);
    }
  }

  // ---- duplicate_invoice ----------------------------------------------
  const invoices = await prisma.invoice.findMany({
    select: {
      id: true,
      distributor: true,
      invoiceNumber: true,
      invoiceDate: true,
      total: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const seenNumber = new Map<string, string>(); // distributor|number -> first id
  const seenDateTotal = new Map<string, string>();
  for (const inv of invoices) {
    const nk = `${inv.distributor.toLowerCase()}|${inv.invoiceNumber.toLowerCase()}`;
    const dk =
      inv.total != null
        ? `${inv.invoiceDate.toISOString().slice(0, 10)}|${inv.total.toFixed(2)}`
        : null;
    if (seenNumber.has(nk)) {
      await raise(`duplicate_invoice:${inv.id}`, {
        type: "duplicate_invoice",
        severity: "warning",
        message: `Possible duplicate: ${inv.distributor} invoice ${inv.invoiceNumber} matches an earlier entry.`,
      });
      summary.duplicate_invoice++;
    } else if (dk && seenDateTotal.has(dk)) {
      await raise(`duplicate_invoice:${inv.id}`, {
        type: "duplicate_invoice",
        severity: "info",
        message: `Possible duplicate: ${inv.distributor} invoice ${inv.invoiceNumber} has the same date and total as an earlier invoice.`,
      });
      summary.duplicate_invoice++;
    }
    seenNumber.set(nk, inv.id);
    if (dk) seenDateTotal.set(dk, inv.id);
  }

  // ---- negative_stock --------------------------------------------------
  const onHand = await prisma.stockMovement.groupBy({
    by: ["productId", "warehouseId"],
    _sum: { quantity: true },
  });
  const negatives = onHand.filter((r) => (r._sum.quantity ?? 0) < 0);
  if (negatives.length > 0) {
    const [prods, whs] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: negatives.map((n) => n.productId) } },
        select: { id: true, name: true },
      }),
      prisma.warehouse.findMany({ select: { id: true, name: true } }),
    ]);
    const pName = new Map(prods.map((p) => [p.id, p.name]));
    const wName = new Map(whs.map((w) => [w.id, w.name]));
    for (const n of negatives) {
      const q = n._sum.quantity ?? 0;
      await raise(`negative_stock:${n.productId}:${n.warehouseId}`, {
        type: "negative_stock",
        productId: n.productId,
        severity: "critical",
        message: `${pName.get(n.productId) ?? "Product"} is at ${q} in ${wName.get(n.warehouseId) ?? "a warehouse"} (below zero).`,
      });
      summary.negative_stock++;
    }
  }

  // ---- quantity_spike --------------------------------------------------
  const checkouts = await prisma.stockMovement.findMany({
    where: { type: "check_out" },
    select: {
      id: true,
      productId: true,
      quantity: true,
      product: { select: { name: true } },
    },
  });
  const byProduct = new Map<string, typeof checkouts>();
  for (const c of checkouts) {
    if (!byProduct.has(c.productId)) byProduct.set(c.productId, []);
    byProduct.get(c.productId)!.push(c);
  }
  for (const list of byProduct.values()) {
    if (list.length < SPIKE_MIN_SAMPLES) continue;
    const mags = list.map((c) => Math.abs(c.quantity));
    const avg = mags.reduce((s, x) => s + x, 0) / mags.length;
    if (avg <= 0) continue;
    for (const c of list) {
      const mag = Math.abs(c.quantity);
      if (mag > avg * SPIKE_FACTOR) {
        await raise(`quantity_spike:${c.id}`, {
          type: "quantity_spike",
          productId: c.productId,
          severity: "warning",
          message: `Unusual check-out of ${mag} ${c.product?.name ?? "product"} (typical ~${avg.toFixed(1)}).`,
        });
        summary.quantity_spike++;
      }
    }
  }

  return summary;
}
