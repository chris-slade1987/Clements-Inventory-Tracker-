import { parseCsvObjects } from "@/lib/csv";

export type StockRow = {
  warehouseRaw: string;
  materialCode: string;
  productName: string;
  qty: number;
  uom: string;
  extendedCost: number | null;
};

function num(s: string): number {
  const n = parseFloat((s ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function money(s: string): number | null {
  const n = parseFloat((s ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a stock-on-hand file. Handles the PestPac "Inventory On-Hand Report"
 * tab-delimited export directly, and falls back to a generic CSV with columns
 * like warehouse, product, qty, uom, cost, material.
 */
export function parseInventoryReport(text: string): {
  rows: StockRow[];
  warehousesSeen: string[];
} {
  const clean = text.replace(/\r/g, "");
  const isPestPac = /(^|\n)Type\t/.test(clean) || /\nWarehouse\t/.test(clean);

  const rows: StockRow[] = [];
  const seen = new Set<string>();

  if (isPestPac) {
    for (const line of clean.split("\n")) {
      const c = line.split("\t");
      if (c[0] !== "Warehouse" || c.length < 6) continue;
      const qty = num(c[4]);
      const warehouseRaw = c[1].trim();
      seen.add(warehouseRaw);
      rows.push({
        warehouseRaw,
        materialCode: (c[2] ?? "").trim(),
        productName: (c[3] ?? "").trim(),
        qty,
        uom: (c[5] ?? "").trim(),
        extendedCost: money(c[6] ?? ""),
      });
    }
    return { rows, warehousesSeen: [...seen] };
  }

  // Generic CSV fallback.
  const { rows: objs } = parseCsvObjects(clean);
  const pick = (o: Record<string, string>, keys: string[]) => {
    for (const k of keys) if (o[k]) return o[k].trim();
    return "";
  };
  for (const o of objs) {
    const productName = pick(o, ["product", "productname", "name", "material"]);
    if (!productName) continue;
    const warehouseRaw = pick(o, ["warehouse", "branch", "location", "name"]);
    seen.add(warehouseRaw);
    rows.push({
      warehouseRaw,
      materialCode: pick(o, ["material", "materialcode", "code"]),
      productName,
      qty: num(pick(o, ["qty", "quantity", "onhand"])),
      uom: pick(o, ["uom", "unit", "unitofmeasure"]),
      extendedCost: money(pick(o, ["cost", "extendedcost", "totalcost"])),
    });
  }
  return { rows, warehousesSeen: [...seen] };
}

/** Match a report warehouse label ("Vero Beach - Branch 1") to our branch. */
export function matchBranch(
  raw: string,
  warehouses: { id: string; name: string }[]
): { id: string; name: string } | undefined {
  const base = raw
    .replace(/\s*-\s*branch\s*\d+.*$/i, "")
    .trim()
    .toLowerCase();
  return (
    warehouses.find((w) => w.name.toLowerCase() === base) ||
    warehouses.find((w) => w.name.toLowerCase().startsWith(base)) ||
    warehouses.find((w) => w.name.toLowerCase().includes(base)) ||
    warehouses.find((w) => base.includes(w.name.toLowerCase().split(" (")[0]))
  );
}
