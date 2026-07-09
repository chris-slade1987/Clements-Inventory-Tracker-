import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseCsvObjects } from "@/lib/csv";

export const runtime = "nodejs";

function pick(row: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) if (row[a]) return row[a].trim();
  return "";
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const type = String(form?.get("type") ?? "");
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "Upload a CSV file." }, { status: 400 });
  if (type !== "products" && type !== "technicians")
    return NextResponse.json({ error: "Unknown import type." }, { status: 400 });

  const text = Buffer.from(await file.arrayBuffer()).toString("utf8");
  const { rows } = parseCsvObjects(text);
  if (rows.length === 0)
    return NextResponse.json({ error: "No data rows found in the CSV." }, { status: 400 });

  let created = 0,
    updated = 0;
  const skipped: string[] = [];

  if (type === "products") {
    const existing = await prisma.product.findMany();
    const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
    for (const [i, row] of rows.entries()) {
      const name = pick(row, ["name", "product", "productname"]);
      const unit = pick(row, ["unitofmeasure", "unit", "uom"]) || "ea";
      if (!name) {
        skipped.push(`Row ${i + 2}: missing name`);
        continue;
      }
      const data = {
        name,
        unitOfMeasure: unit,
        manufacturer: pick(row, ["manufacturer", "mfr", "brand"]) || null,
        epaRegNumber: pick(row, ["eparegnumber", "epareg", "epa"]) || null,
        category: pick(row, ["category", "cat"]) || null,
        barcode: pick(row, ["barcode", "upc"]) || null,
        distributorSku: pick(row, ["distributorsku", "sku"]) || null,
      };
      try {
        const found = byName.get(name.toLowerCase());
        if (found) {
          await prisma.product.update({ where: { id: found.id }, data });
          updated++;
        } else {
          await prisma.product.create({ data });
          created++;
        }
      } catch (e) {
        const msg = (e as { code?: string }).code === "P2002" ? "duplicate barcode" : (e as Error).message;
        skipped.push(`Row ${i + 2} (${name}): ${msg}`);
      }
    }
  } else {
    const warehouses = await prisma.warehouse.findMany();
    const existing = await prisma.technician.findMany();
    const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
    const matchWarehouse = (val: string) => {
      const v = val.toLowerCase().trim();
      return (
        warehouses.find((w) => w.name.toLowerCase() === v) ||
        warehouses.find((w) => w.name.toLowerCase().startsWith(v)) ||
        warehouses.find((w) => w.name.toLowerCase().includes(v))
      );
    };
    for (const [i, row] of rows.entries()) {
      const name = pick(row, ["name", "technician", "techname"]);
      const whName = pick(row, ["homewarehouse", "warehouse", "location", "branch"]);
      if (!name) {
        skipped.push(`Row ${i + 2}: missing name`);
        continue;
      }
      const wh = matchWarehouse(whName);
      if (!wh) {
        skipped.push(`Row ${i + 2} (${name}): warehouse "${whName}" not found`);
        continue;
      }
      const data = {
        name,
        homeWarehouseId: wh.id,
        employeeIdCard: pick(row, ["employeeidcard", "card", "fdacs", "fdacscard"]) || null,
      };
      try {
        const found = byName.get(name.toLowerCase());
        if (found) {
          await prisma.technician.update({ where: { id: found.id }, data });
          updated++;
        } else {
          await prisma.technician.create({ data });
          created++;
        }
      } catch (e) {
        skipped.push(`Row ${i + 2} (${name}): ${(e as Error).message}`);
      }
    }
  }

  return NextResponse.json({ ok: true, created, updated, skipped });
}
