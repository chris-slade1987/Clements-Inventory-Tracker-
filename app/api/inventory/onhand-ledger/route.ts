import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { userCanAccess } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 20;

// GET /api/inventory/onhand-ledger?productId=…&warehouseId=…
//
// "How this on-hand number was built" for one product at one branch (COO
// 2026-11-23: checked in 160, dispersed 120 — On-hand must show 40, and when it
// doesn't we need to see why). On-hand = SUM of stock movements, so this returns
// every movement in date order with a running total, labelled by what it was:
// a receipt (invoice # + distributor), a check-out (technician), or an adjustment
// (go-live baseline, shelf count, reversal, correction — with its reason).
// Read-only; same access as Reports.

type Kind = "received" | "dispersed" | "baseline" | "count" | "reversal" | "adjustment";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "manager" && !(await userCanAccess(user, "reports")))
    return NextResponse.json({ error: "You don't have access to Reports." }, { status: 403 });

  const url = new URL(req.url);
  const productId = url.searchParams.get("productId") ?? "";
  const warehouseId = url.searchParams.get("warehouseId") ?? "";
  if (!productId || !warehouseId) return NextResponse.json({ error: "Missing product or warehouse." }, { status: 400 });

  const moves = await prisma.stockMovement.findMany({
    where: { productId, warehouseId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, type: true, quantity: true, reason: true, createdAt: true, reversalOfId: true,
      reversedBy: { select: { id: true } },
      sourceInvoice: { select: { invoiceNumber: true, distributor: true, status: true } },
      technician: { select: { name: true } },
      user: { select: { name: true } },
    },
  });

  let running = 0;
  const sums: Record<Kind, number> = { received: 0, dispersed: 0, baseline: 0, count: 0, reversal: 0, adjustment: 0 };
  const rows = moves.map((m) => {
    const reason = m.reason ?? "";
    const kind: Kind =
      m.type === "check_in" ? "received"
      : m.type === "check_out" ? "dispersed"
      : /go-live on-hand baseline/i.test(reason) ? "baseline"
      : m.reversalOfId ? "reversal"
      : /count|reconcil/i.test(reason) ? "count"
      : "adjustment";
    const label =
      kind === "received" ? `Received${m.sourceInvoice ? ` · ${m.sourceInvoice.distributor} #${m.sourceInvoice.invoiceNumber}` : ""}`
      : kind === "dispersed" ? `Checked out${m.technician ? ` to ${m.technician.name}` : ""}`
      : reason || "Adjustment";
    running += m.quantity;
    sums[kind] += m.quantity;
    return {
      id: m.id,
      date: m.createdAt.toISOString(),
      kind,
      label,
      by: m.user?.name ?? null,
      quantity: Math.round(m.quantity * 10000) / 10000,
      running: Math.round(running * 10000) / 10000,
      reversed: !!m.reversedBy,
    };
  });

  const r = (n: number) => Math.round(n * 10000) / 10000;
  return NextResponse.json({
    rows,
    summary: {
      received: r(sums.received),
      dispersed: r(sums.dispersed),
      baseline: r(sums.baseline),
      counts: r(sums.count),
      reversals: r(sums.reversal),
      other: r(sums.adjustment),
      onHand: r(running),
    },
  });
}
