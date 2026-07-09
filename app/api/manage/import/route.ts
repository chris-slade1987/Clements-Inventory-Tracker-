import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseCsvObjects } from "@/lib/csv";
import { readXlsxObjects } from "@/lib/xlsx";
import { normalizeRole, normalizeDivision } from "@/lib/constants";

export const runtime = "nodejs";

function pick(row: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) if (row[a]) return row[a].trim();
  return "";
}

function isXlsx(name: string, mime: string) {
  return (
    name.toLowerCase().endsWith(".xlsx") ||
    mime.includes("spreadsheetml") ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const type = String(form?.get("type") ?? "");
  const replace = String(form?.get("replace") ?? "") === "true";
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "Upload a file." }, { status: 400 });
  if (type !== "products" && type !== "technicians")
    return NextResponse.json({ error: "Unknown import type." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const name = (file as File).name ?? "";
  const mime = file.type ?? "";

  let rows: Record<string, string>[];
  if (isXlsx(name, mime)) {
    rows = readXlsxObjects(new Uint8Array(bytes)).rows;
  } else {
    rows = parseCsvObjects(bytes.toString("utf8")).rows;
  }
  if (rows.length === 0)
    return NextResponse.json({ error: "No data rows found in the file." }, { status: 400 });

  let created = 0,
    updated = 0;
  const skipped: string[] = [];

  if (type === "products") {
    const existing = await prisma.product.findMany();
    const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
    for (const [i, row] of rows.entries()) {
      const pname = pick(row, ["name", "product", "productname"]);
      const unit = pick(row, ["unitofmeasure", "unit", "uom"]) || "ea";
      if (!pname) {
        skipped.push(`Row ${i + 2}: missing name`);
        continue;
      }
      const data = {
        name: pname,
        unitOfMeasure: unit,
        manufacturer: pick(row, ["manufacturer", "mfr", "brand"]) || null,
        epaRegNumber: pick(row, ["eparegnumber", "epareg", "epa"]) || null,
        category: pick(row, ["category", "cat"]) || null,
        barcode: pick(row, ["barcode", "upc"]) || null,
        distributorSku: pick(row, ["distributorsku", "sku"]) || null,
      };
      try {
        const found = byName.get(pname.toLowerCase());
        if (found) {
          await prisma.product.update({ where: { id: found.id }, data });
          updated++;
        } else {
          await prisma.product.create({ data });
          created++;
        }
      } catch (e) {
        const msg = (e as { code?: string }).code === "P2002" ? "duplicate barcode" : (e as Error).message;
        skipped.push(`Row ${i + 2} (${pname}): ${msg}`);
      }
    }
  } else {
    // Employees / technicians.
    const warehouses = await prisma.warehouse.findMany();
    const matchWarehouse = (val: string) => {
      const v = val.toLowerCase().trim();
      return (
        warehouses.find((w) => w.name.toLowerCase() === v) ||
        warehouses.find((w) => w.name.toLowerCase().startsWith(v)) ||
        warehouses.find((w) => w.name.toLowerCase().includes(v)) ||
        warehouses.find((w) => v.includes(w.name.toLowerCase().split(" (")[0]))
      );
    };

    // Replace mode: deactivate everyone first; imported rows get reactivated.
    if (replace) await prisma.technician.updateMany({ data: { active: false } });

    const existing = await prisma.technician.findMany();
    const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
    for (const [i, row] of rows.entries()) {
      const tname = pick(row, ["name", "employeename", "technician", "techname"]);
      const whName = pick(row, ["branchwarehouse", "homewarehouse", "warehouse", "location", "branch"]);
      if (!tname) {
        skipped.push(`Row ${i + 2}: missing name`);
        continue;
      }
      const wh = matchWarehouse(whName);
      if (!wh) {
        skipped.push(`Row ${i + 2} (${tname}): branch "${whName}" not found`);
        continue;
      }
      const data = {
        name: tname,
        homeWarehouseId: wh.id,
        employeeIdCard: pick(row, ["employeeidcard", "card", "fdacs", "fdacscard"]) || null,
        role: normalizeRole(pick(row, ["role", "title", "position"])),
        division: normalizeDivision(pick(row, ["division", "dept", "department"])),
        active: true,
      };
      try {
        const found = byName.get(tname.toLowerCase());
        if (found) {
          await prisma.technician.update({ where: { id: found.id }, data });
          updated++;
        } else {
          await prisma.technician.create({ data });
          created++;
        }
      } catch (e) {
        skipped.push(`Row ${i + 2} (${tname}): ${(e as Error).message}`);
      }
    }
  }

  return NextResponse.json({ ok: true, created, updated, skipped });
}
