import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseInventoryReport, matchBranch } from "@/lib/pestpac";
import { normalizeCategory, unitLabel } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const EPS = 1e-6;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const label = String(form?.get("label") ?? "").trim();
  const reset = String(form?.get("reset") ?? "") === "true";
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "Upload the inventory report file." }, { status: 400 });

  const text = Buffer.from(await file.arrayBuffer()).toString("utf8");
  const { rows, warehousesSeen } = parseInventoryReport(text);
  if (rows.length === 0)
    return NextResponse.json({ error: "No stock rows found in the file." }, { status: 400 });

  // First-load option: clear the demo/sample catalog and all stock so the
  // import starts from a clean slate. Branches, managers, technicians, and
  // settings are preserved. Only intended for the initial load before go-live.
  if (reset) {
    await prisma.$transaction([
      prisma.alert.deleteMany(),
      prisma.stockMovement.deleteMany(),
      prisma.invoiceLine.deleteMany(),
      prisma.invoice.deleteMany(),
      prisma.product.deleteMany(),
    ]);
  }

  const warehouses = await prisma.warehouse.findMany({ where: { active: true } });

  // Resolve each report warehouse label to a branch.
  const branchFor = new Map<string, { id: string; name: string }>();
  const unmatchedBranches: string[] = [];
  for (const raw of warehousesSeen) {
    const b = matchBranch(raw, warehouses);
    if (b) branchFor.set(raw, b);
    else unmatchedBranches.push(raw);
  }

  // Create any products not already in the catalog (match by name).
  const existing = await prisma.product.findMany();
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
  const newByName = new Map<string, { name: string; unitOfMeasure: string; category: string; distributorSku: string | null }>();
  for (const r of rows) {
    if (!r.productName) continue;
    const key = r.productName.toLowerCase();
    if (byName.has(key) || newByName.has(key)) continue;
    newByName.set(key, {
      name: r.productName,
      unitOfMeasure: unitLabel(r.uom),
      category: normalizeCategory(r.productName),
      distributorSku: r.materialCode || null,
    });
  }
  if (newByName.size > 0) {
    await prisma.product.createMany({ data: [...newByName.values()] });
  }

  // Rebuild the name -> id map (now including the created products).
  const allProducts = await prisma.product.findMany({ select: { id: true, name: true } });
  const idByName = new Map(allProducts.map((p) => [p.name.toLowerCase(), p.id]));

  // Aggregate target qty + cost per (branch, product).
  type Agg = { productId: string; warehouseId: string; qty: number; cost: number };
  const targets = new Map<string, Agg>();
  let rowsSkipped = 0;
  for (const r of rows) {
    const branch = branchFor.get(r.warehouseRaw);
    const productId = idByName.get(r.productName.toLowerCase());
    if (!branch || !productId) {
      rowsSkipped++;
      continue;
    }
    const k = `${branch.id}|${productId}`;
    const agg = targets.get(k) ?? { productId, warehouseId: branch.id, qty: 0, cost: 0 };
    agg.qty += r.qty;
    agg.cost += r.extendedCost ?? 0;
    targets.set(k, agg);
  }

  // Current on-hand per product+warehouse.
  const onHandRows = await prisma.stockMovement.groupBy({
    by: ["productId", "warehouseId"],
    _sum: { quantity: true },
  });
  const currentOnHand = new Map<string, number>();
  for (const h of onHandRows)
    currentOnHand.set(`${h.warehouseId}|${h.productId}`, h._sum.quantity ?? 0);

  // Build difference adjustments so on-hand becomes the counted quantity.
  const reason = `Stock count import${label ? ` (${label})` : ""}`;
  const movements: {
    type: string;
    productId: string;
    warehouseId: string;
    quantity: number;
    unitPrice: number | null;
    reason: string;
    userId: string;
  }[] = [];
  for (const t of targets.values()) {
    const current = currentOnHand.get(`${t.warehouseId}|${t.productId}`) ?? 0;
    const delta = t.qty - current;
    if (Math.abs(delta) < EPS) continue;
    movements.push({
      type: "adjustment",
      productId: t.productId,
      warehouseId: t.warehouseId,
      quantity: delta,
      unitPrice: t.qty > 0 ? Number((t.cost / t.qty).toFixed(4)) : null,
      reason,
      userId: user.id,
    });
  }
  if (movements.length > 0) {
    await prisma.stockMovement.createMany({ data: movements });
  }

  return NextResponse.json({
    ok: true,
    productsCreated: newByName.size,
    productsMatched: targets.size,
    branchesMatched: [...branchFor.values()].map((b) => b.name),
    unmatchedBranches,
    adjustmentsPosted: movements.length,
    rowsSkipped,
  });
}
