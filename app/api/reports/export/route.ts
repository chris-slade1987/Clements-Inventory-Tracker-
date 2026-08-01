import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  onHandByProduct,
  parseFilters,
  warehouseMetrics,
} from "@/lib/reporting";

export const dynamic = "force-dynamic";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: (string | number)[]) => cells.map(csvCell).join(",");

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const filters = parseFilters(sp);

  const [warehouses, metrics, productRows] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    warehouseMetrics(filters),
    onHandByProduct(filters),
  ]);

  const lines: string[] = [];
  lines.push("CanopyOS — Report");
  lines.push(
    row([
      "Range",
      filters.from ? filters.from.toISOString().slice(0, 10) : "all",
      "to",
      filters.to ? filters.to.toISOString().slice(0, 10) : "all",
    ])
  );
  lines.push("");

  // Section 1: warehouse summary.
  lines.push("Warehouse summary");
  lines.push(
    row(["Warehouse", "Purchased qty", "Purchased $", "Dispersed qty", "On-hand qty"])
  );
  for (const w of warehouses) {
    const m = metrics.get(w.id);
    lines.push(
      row([
        w.name,
        m?.purchasedQty ?? 0,
        (m?.purchasedValue ?? 0).toFixed(2),
        m?.dispersedQty ?? 0,
        m?.onHandQty ?? 0,
      ])
    );
  }
  lines.push("");

  // Section 2: on-hand by product per warehouse.
  lines.push("On-hand by product");
  lines.push(row(["Product", "Category", "Unit", ...warehouses.map((w) => w.name), "Total"]));
  for (const p of productRows) {
    lines.push(
      row([
        p.name,
        p.category,
        p.unit,
        ...warehouses.map((w) => p.byWarehouse[w.id] ?? 0),
        p.total,
      ])
    );
  }

  const csv = lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clements-report.csv"`,
    },
  });
}
