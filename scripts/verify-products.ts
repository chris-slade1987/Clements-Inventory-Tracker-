import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { parseCsvObjects } from "../lib/csv";
import { categorizeProduct, unitLabel } from "../lib/constants";

function pick(row: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) if (row[a]) return row[a].trim();
  return "";
}

async function main() {
  const csv = readFileSync("data/products_enriched.csv", "utf8");
  const { rows } = parseCsvObjects(csv);
  console.log("rows in csv:", rows.length);

  let created = 0, updated = 0;
  const skipped: string[] = [];
  const existing = await prisma.product.findMany();
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));

  for (const [i, row] of rows.entries()) {
    const pname = pick(row, ["name", "product", "productname"]);
    const unit = pick(row, ["unitofmeasure", "unit", "uom"]) || "ea";
    if (!pname) { skipped.push(`Row ${i + 2}: missing name`); continue; }
    const ai = pick(row, ["activeingredient", "active", "ai"]);
    const target = pick(row, ["targetpest", "target", "pest"]);
    const providedCat = pick(row, ["category", "cat"]);
    const data = {
      name: pname,
      unitOfMeasure: unitLabel(unit),
      manufacturer: pick(row, ["manufacturer", "mfr", "brand"]) || null,
      epaRegNumber: pick(row, ["eparegnumber", "epareg", "epa", "eparegistration"]) || null,
      category: providedCat || categorizeProduct(pname, ai, target, unit),
      activeIngredient: ai || null,
      targetPest: target || null,
      applicationMethod: pick(row, ["applicationmethod", "application", "method"]) || null,
      barcode: pick(row, ["barcode", "upc"]) || null,
      distributorSku: pick(row, ["distributorsku", "sku", "materialcode", "material"]) || null,
    };
    const found = byName.get(pname.toLowerCase());
    if (found) { await prisma.product.update({ where: { id: found.id }, data }); updated++; }
    else { await prisma.product.create({ data }); created++; }
  }

  console.log(`created ${created}, updated ${updated}, skipped ${skipped.length}`);
  const all = await prisma.product.findMany();
  const cats: Record<string, number> = {};
  for (const p of all) cats[p.category ?? "(none)"] = (cats[p.category ?? "(none)"] ?? 0) + 1;
  console.log("total products:", all.length);
  console.log("by category:", cats);
  const sample = await prisma.product.findFirst({ where: { epaRegNumber: { not: null } } });
  console.log("sample regulatory row:", sample?.name, "| EPA", sample?.epaRegNumber, "| AI", sample?.activeIngredient);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
