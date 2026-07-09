import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

type NewProduct = {
  name: string;
  unitOfMeasure?: string;
  manufacturer?: string;
  epaRegNumber?: string;
  category?: string;
};

type LineIn = {
  productId?: string | null;
  newProduct?: NewProduct | null;
  descriptionRaw: string;
  quantity: number;
  unit?: string | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
};

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const warehouseId: string = body?.warehouseId ?? "";
  const filePath: string | null = body?.filePath ?? null;
  const distributor: string = (body?.distributor ?? "").trim() || "Unknown";
  const invoiceNumber: string = (body?.invoiceNumber ?? "").trim();
  const invoiceDateRaw: string = body?.invoiceDate ?? "";
  const subtotal = numOrNull(body?.subtotal);
  const total = numOrNull(body?.total);
  const rawLines: LineIn[] = Array.isArray(body?.lines) ? body.lines : [];

  if (!warehouseId) {
    return NextResponse.json({ error: "Select a warehouse." }, { status: 400 });
  }
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) {
    return NextResponse.json({ error: "Warehouse not found." }, { status: 404 });
  }

  // Keep lines that have a positive quantity and a product (existing or new).
  const lines = rawLines.filter(
    (l) =>
      Number(l.quantity) > 0 &&
      (l.productId || (l.newProduct && l.newProduct.name?.trim()))
  );
  if (lines.length === 0) {
    return NextResponse.json(
      { error: "Add at least one line with a product and quantity." },
      { status: 400 }
    );
  }

  const invoiceDate = parseDate(invoiceDateRaw);

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        distributor,
        invoiceNumber: invoiceNumber || `NA-${Date.now()}`,
        invoiceDate,
        warehouseId,
        filePath,
        subtotal,
        total,
        status: "confirmed",
        uploadedById: user.id,
      },
    });

    let itemCount = 0;
    for (const l of lines) {
      // Resolve product (create if new).
      let productId = l.productId ?? null;
      if (!productId && l.newProduct?.name) {
        const created = await tx.product.create({
          data: {
            name: l.newProduct.name.trim(),
            unitOfMeasure: (l.newProduct.unitOfMeasure ?? l.unit ?? "ea").trim(),
            manufacturer: l.newProduct.manufacturer?.trim() || null,
            epaRegNumber: l.newProduct.epaRegNumber?.trim() || null,
            category: l.newProduct.category?.trim() || null,
          },
        });
        productId = created.id;
      }
      if (!productId) continue;

      const qty = Math.abs(Number(l.quantity));
      const unitPrice = numOrNull(l.unitPrice);

      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          productId,
          descriptionRaw: l.descriptionRaw ?? "",
          quantity: qty,
          unit: l.unit ?? null,
          unitPrice,
          lineTotal: numOrNull(l.lineTotal),
          matched: true,
        },
      });

      // Positive check_in movement. Price history is derived from invoice_lines.
      await tx.stockMovement.create({
        data: {
          type: "check_in",
          productId,
          warehouseId,
          quantity: qty,
          unitPrice,
          sourceInvoiceId: invoice.id,
          userId: user.id,
        },
      });
      itemCount += qty;
    }

    return { invoiceId: invoice.id, itemCount, lineCount: lines.length };
  });

  return NextResponse.json({
    ok: true,
    invoiceId: result.invoiceId,
    receipt: {
      warehouse: warehouse.name,
      distributor,
      invoiceNumber: invoiceNumber || "(none)",
      itemCount: result.itemCount,
      lineCount: result.lineCount,
    },
  });
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function parseDate(s: string): Date {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
