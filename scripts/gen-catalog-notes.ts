/**
 * Generate docs/CATALOG-NOTES.md — the full catalog grouped by family (so
 * look-alikes sit together) for the owner to annotate. Reads the owner master
 * (01_product_catalog.csv) + the research profiles (product-research.json).
 * Run:  npx tsx scripts/gen-catalog-notes.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.cwd();
const csvText = readFileSync(join(DIR, "prisma/data/inventory-reset/01_product_catalog.csv"), "utf8");
const research = JSON.parse(readFileSync(join(DIR, "prisma/data/product-research.json"), "utf8")) as { name: string; form?: string | null; activeIngredient?: string | null; manufacturer?: string | null }[];

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let cur: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { cur.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; if (f !== "" || cur.length) { cur.push(f); rows.push(cur); cur = []; f = ""; } }
    else f += c; }
  if (f !== "" || cur.length) { cur.push(f); rows.push(cur); }
  const h = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] ?? "").trim()])));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const researchByNorm = new Map(research.map((r) => [norm(r.name), r]));
function findResearch(name: string) {
  const n = norm(name);
  if (researchByNorm.has(n)) return researchByNorm.get(n);
  for (const r of research) { const rn = norm(r.name); if (rn.startsWith(n) || n.startsWith(rn)) return r; }
  return undefined;
}

const BRAND = /^(lesco|wellmark|nufarm|syngenta|pbi gordon|pbi|gordon|helena|arborjet|albaugh|bwi|siteone)\s+/i;
function familyOf(name: string): string {
  let s = name.replace(BRAND, "");
  // drop leading NPK / size numbers so fertilizers group under "Fertilizer".
  const alpha = s.replace(/[0-9][0-9.\-%]*/g, " ").replace(/\s+/g, " ").trim();
  const first = alpha.split(" ")[0] || "Other";
  if (/^fertilizer$/i.test(first) || /fertilizer/i.test(name) || /^\d/.test(name.replace(BRAND, ""))) return "Fertilizers";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

const rows = parseCsv(csvText).filter((r) => r.inventory_product);
const families = new Map<string, Record<string, string>[]>();
for (const r of rows) {
  const fam = familyOf(r.inventory_product);
  (families.get(fam) ?? families.set(fam, []).get(fam)!).push(r);
}

let md = `# Catalog consolidation — review & notes

**How to use this file.** Every real product is listed below, grouped by family so look-alikes sit together. Add a note under any product (or family) and I'll adjust the consolidation. Three shortcuts take effect automatically on the next deploy (I translate your notes into \`prisma/data/catalog-overrides.json\`):

- **Merge:** "merge A into B" → folds duplicate A into canonical B (on-hand + history move to B).
- **Keep separate:** "A and B are different" → they will never be merged.
- **Rename:** "rename A to …" → changes the catalog display name.

Anything else (reclassify, split one row into two, fix an active ingredient, change a unit, etc.) — just write it in plain English under the product and I'll make the code/data change.

Identity is the **SiteOne item number** (the invoice key): different item numbers are always different products; the same item number is always the same product.

_Generated from \`prisma/data/inventory-reset/01_product_catalog.csv\` + \`prisma/data/product-research.json\`. Regenerate with \`npx tsx scripts/gen-catalog-notes.ts\`._

---
`;

for (const fam of [...families.keys()].sort()) {
  const items = families.get(fam)!.sort((a, b) => a.inventory_product.localeCompare(b.inventory_product));
  md += `\n## ${fam}\n`;
  if (items.length > 1) md += `\n_${items.length} products in this family — check these are genuinely distinct (different item #, NPK, size, or formula) vs. duplicates to merge._\n`;
  for (const r of items) {
    const rsrch = findResearch(r.inventory_product);
    const items2 = r.siteone_item_numbers || "—";
    const bits = [
      rsrch?.form ? `form: ${rsrch.form}` : null,
      rsrch?.activeIngredient ? `active: ${rsrch.activeIngredient}` : null,
      r.category ? `cat: ${r.category}` : null,
      r.unit_cost ? `cost: $${r.unit_cost}` : null,
    ].filter(Boolean).join(" · ");
    md += `\n### ${r.inventory_product}\n`;
    md += `- SiteOne item #: \`${items2}\`${r.july_count_short_name ? ` · short name: "${r.july_count_short_name}"` : ""}\n`;
    if (bits) md += `- ${bits}\n`;
    md += `- **Notes:** _(add yours here)_\n`;
  }
}

writeFileSync(join(DIR, "docs/CATALOG-NOTES.md"), md);
console.log(`Wrote docs/CATALOG-NOTES.md — ${rows.length} products across ${families.size} families.`);
