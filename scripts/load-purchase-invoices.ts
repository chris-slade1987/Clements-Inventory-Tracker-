/**
 * General distributor purchase-invoice loader — PREVIEW + APPLY.
 *
 * Reads every committed purchase-invoice JSON under
 * prisma/data/purchase-invoices/*.json (currently the SiteOne Aug + Sep 2026
 * line-item files) and records each invoice as a CONFIRMED Invoice plus stock
 * movements, on TOP of the 7/31/2026 reconciliation baseline. These are
 * incremental distributor receipts, not a reset.
 *
 * CORE DATA RULE (AGENTS.md / CLAUDE.md): on-hand = SUM(StockMovement.quantity).
 * A received line (qty_shipped > 0) posts a POSITIVE `check_in` movement. A vendor
 * CREDIT line (qty_shipped < 0, e.g. the Sep fertilizer credit memo) posts a
 * negative `adjustment` movement (never a negative check_in — check_in stays
 * positive) with a reason, so net on-hand is correct and the audit trail is kept.
 * Nothing is ever hard-deleted.
 *
 * BRANCH IS PER INVOICE: the warehouse is resolved from each invoice's own
 * `branch` (from the CSV `clements_branch` column) — NEVER assumed from the file
 * name. An invoice whose branch does not resolve to a known warehouse is NOT
 * loaded; it is reported as an error (STOP, don't default to any branch).
 *
 * PARSE / MATCH RULES (see lib/invoice/siteone-aliases.ts):
 *   - Received qty = qty_shipped. Zero-shipped lines are already excluded from the
 *     JSON (pure backorders/cancels). Partial shipments post ONLY the shipped qty.
 *   - FUEL SURCHARGE / pure surcharge item #s (SURCHARGE_ITEMS) never post stock.
 *   - Each line resolves by SiteOne item # via SITEONE_ALIASES to a catalog
 *     product; a genuinely-missing chemical/fertilizer in CREATED_PRODUCTS is
 *     created (approved=false, confirmed=false — check-out gate). A line whose
 *     item # is in neither map is NOT loaded — reported as "unmatched (needs
 *     review)" (this is where equipment, PPE and other non-catalog items land; we
 *     never fabricate a chemical for them).
 *   - Qty_shipped is taken as a count of CATALOG units (one container = one unit);
 *     the product keeps its existing catalog UoM. Known multi-packs are flagged in
 *     siteone-aliases.ts and in this report, but still loaded 1 shipped = 1 unit.
 *
 * IDEMPOTENT per (vendor/distributor, invoiceNumber): an invoice whose number
 * already exists for that distributor is skipped, so redeploys never double-add.
 * Transactional per invoice.
 *
 *   Preview:  DATABASE_URL=... tsx scripts/load-purchase-invoices.ts
 *   Apply:    DATABASE_URL=... tsx scripts/load-purchase-invoices.ts apply
 *
 * deploy-db.ts calls loadPurchaseInvoices(prisma, { apply: true }) after the 7/31
 * reconciliation (owner authorized an automatic apply, no manual step).
 */
import type { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeProductName } from "../lib/product-aliases";
import { categorizeProduct, normalizeClassification } from "../lib/constants";
import { uomCode } from "../lib/uom";
import { SITEONE_ALIASES, CREATED_PRODUCTS, SURCHARGE_ITEMS } from "../lib/invoice/siteone-aliases";

const DATA_DIR = join(process.cwd(), "prisma", "data", "purchase-invoices");

// clements_branch (from the CSV) -> Warehouse.name. Normalized (lower-case,
// collapsed) on the left. No default: an unrecognized branch stops that invoice.
const BRANCH_TO_WAREHOUSE: Record<string, string> = {
  "vero beach": "Vero Beach (HQ)",
  "vero beach (hq)": "Vero Beach (HQ)",
  "vero beach hq": "Vero Beach (HQ)",
  vero: "Vero Beach (HQ)",
  stuart: "Stuart",
  orlando: "Orlando",
  naples: "Naples",
};

function resolveWarehouseName(branch: string): string | null {
  return BRANCH_TO_WAREHOUSE[branch.trim().toLowerCase()] ?? null;
}

type JsonLine = {
  line: number | string;
  itemNumber: string;
  description: string;
  uom: string;
  qtyShipped: number;
  netUnitPrice: number;
  extPrice: number;
  category: string;
  subcategory: string;
};
type JsonInvoice = {
  invoiceNumber: string;
  invoiceDate: string;
  branch: string;
  subtotalShipped: number;
  lines: JsonLine[];
};
type JsonDoc = {
  vendor: string;
  branch: string;
  sourceFile: string;
  skippedZeroShipped?: number;
  invoices: JsonInvoice[];
};

export type LineOutcome =
  | "check_in"
  | "credit_adjustment"
  | "skipped_surcharge"
  | "unmatched";

export type FileReport = {
  sourceFile: string;
  vendor: string;
  perBranch: Record<
    string,
    {
      warehouse: string;
      warehouseFound: boolean;
      invoicesCreated: number;
      invoicesSkipped: number; // already loaded (idempotent)
      invoicesStopped: number; // branch unresolved — not loaded
      linesLoaded: number;
      unitsLoaded: number;
      spendLoaded: number; // sum(extPrice) of posted lines (credits negative)
    }
  >;
  skippedZeroShipped: number;
};

export type LoadResult = {
  mode: "preview" | "apply";
  files: FileReport[];
  matchedProducts: Set<string>;
  createdProducts: Set<string>;
  unmatched: Map<string, { itemNumber: string; description: string; count: number; branches: Set<string> }>;
  surchargeSkipped: number;
  creditLines: Array<{ invoiceNumber: string; branch: string; product: string; qty: number; amount: number }>;
  duplicateInvoiceWarnings: string[];
  errors: string[];
};

function readDocs(): JsonDoc[] {
  let names: string[] = [];
  try {
    names = readdirSync(DATA_DIR).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return names.map((n) => JSON.parse(readFileSync(join(DATA_DIR, n), "utf8")) as JsonDoc);
}

/** Cross-file duplicate (vendor, invoiceNumber) check — flag differing shipped totals. */
function detectDuplicates(docs: JsonDoc[]): string[] {
  const seen = new Map<string, { file: string; units: number }>();
  const warns: string[] = [];
  for (const doc of docs) {
    for (const inv of doc.invoices) {
      const key = `${doc.vendor}::${inv.invoiceNumber}`;
      const units = inv.lines.reduce((s, l) => s + l.qtyShipped, 0);
      const prev = seen.get(key);
      if (prev) {
        warns.push(
          `Duplicate invoice ${inv.invoiceNumber} (${doc.vendor}) in ${prev.file} and ${doc.sourceFile}` +
            (prev.units !== units
              ? ` with DIFFERING shipped units (${prev.units} vs ${units}) — a later shipment may be missed.`
              : ` (identical shipped units — loaded once).`),
        );
      } else {
        seen.set(key, { file: doc.sourceFile, units });
      }
    }
  }
  return warns;
}

export async function loadPurchaseInvoices(
  prisma: PrismaClient,
  opts: { apply: boolean } = { apply: false },
): Promise<LoadResult> {
  const docs = readDocs();
  const result: LoadResult = {
    mode: opts.apply ? "apply" : "preview",
    files: [],
    matchedProducts: new Set(),
    createdProducts: new Set(),
    unmatched: new Map(),
    surchargeSkipped: 0,
    creditLines: [],
    duplicateInvoiceWarnings: detectDuplicates(docs),
    errors: [],
  };

  // Catalog index by normalized name (prefer approved on collision).
  const products = await prisma.product.findMany({ select: { id: true, name: true, approved: true, unitOfMeasure: true } });
  const byNorm = new Map<string, { id: string; name: string; approved: boolean; unitOfMeasure: string }>();
  for (const p of products) {
    const norm = normalizeProductName(p.name);
    const prev = byNorm.get(norm);
    if (!prev || (!prev.approved && p.approved)) byNorm.set(norm, p);
  }

  // Ensure a created product exists (idempotent by normalized name). Returns the
  // catalog row. Only writes in apply mode; in preview it reports intent.
  async function ensureCreated(name: string): Promise<{ id: string; unitOfMeasure: string } | null> {
    const norm = normalizeProductName(name);
    const existing = byNorm.get(norm);
    if (existing) return existing;
    const spec = CREATED_PRODUCTS[name];
    if (!spec) return null;
    result.createdProducts.add(name);
    if (!opts.apply) {
      // Preview: pretend it exists with the spec UoM.
      return { id: `(new:${name})`, unitOfMeasure: spec.code };
    }
    const code = uomCode(spec.code) ?? "EA";
    const { division, subdivision } = normalizeClassification(spec.division, spec.subdivision);
    const created = await prisma.product.create({
      data: {
        name,
        unitOfMeasure: code,
        category: spec.category ?? categorizeProduct(name, "", "", code),
        division,
        subdivision,
        manufacturer: spec.manufacturer ?? null,
        approved: false,
        confirmed: false,
        active: true,
        notes: spec.note,
      },
    });
    const row = { id: created.id, name, approved: false, unitOfMeasure: code };
    byNorm.set(norm, row);
    return row;
  }

  for (const doc of docs) {
    const vendor = doc.vendor;
    const fr: FileReport = { sourceFile: doc.sourceFile, vendor, perBranch: {}, skippedZeroShipped: doc.skippedZeroShipped ?? 0 };

    for (const inv of doc.invoices) {
      const whName = resolveWarehouseName(inv.branch);
      const branchKey = inv.branch || "(blank)";
      const pb =
        fr.perBranch[branchKey] ??
        (fr.perBranch[branchKey] = {
          warehouse: whName ?? `(UNRESOLVED: ${inv.branch})`,
          warehouseFound: false,
          invoicesCreated: 0,
          invoicesSkipped: 0,
          invoicesStopped: 0,
          linesLoaded: 0,
          unitsLoaded: 0,
          spendLoaded: 0,
        });

      if (!whName) {
        pb.invoicesStopped++;
        result.errors.push(
          `STOP: invoice ${inv.invoiceNumber} has unresolved Clements Branch "${inv.branch}" — not loaded (no default branch).`,
        );
        continue;
      }
      const warehouse = await prisma.warehouse.findFirst({ where: { name: whName } });
      if (!warehouse) {
        pb.invoicesStopped++;
        result.errors.push(
          `STOP: invoice ${inv.invoiceNumber} branch "${inv.branch}" -> warehouse "${whName}" not found in DB — not loaded.`,
        );
        continue;
      }
      pb.warehouseFound = true;

      // Idempotency: skip an invoice already loaded for this distributor.
      const already = await prisma.invoice.findFirst({
        where: { distributor: vendor, invoiceNumber: inv.invoiceNumber },
        select: { id: true },
      });
      if (already) {
        pb.invoicesSkipped++;
        // Still account for product-mapping stats so the report is complete.
        for (const l of inv.lines) classifyForReport(l, inv.branch, result);
        continue;
      }

      const invoiceDate = parseDate(inv.invoiceDate);

      // Resolve every line first (so preview + apply agree and the tx is tight).
      type Resolved = { line: JsonLine; productId: string | null; unit: string; outcome: LineOutcome };
      const resolved: Resolved[] = [];
      for (const l of inv.lines) {
        if (SURCHARGE_ITEMS.has(l.itemNumber)) {
          result.surchargeSkipped++;
          resolved.push({ line: l, productId: null, unit: l.uom, outcome: "skipped_surcharge" });
          continue;
        }
        const aliasName = SITEONE_ALIASES[l.itemNumber];
        if (!aliasName) {
          recordUnmatched(result, l, inv.branch);
          resolved.push({ line: l, productId: null, unit: l.uom, outcome: "unmatched" });
          continue;
        }
        const prod = byNorm.get(normalizeProductName(aliasName)) ?? (await ensureCreated(aliasName));
        if (!prod) {
          // Alias points at a name that neither exists nor is in CREATED_PRODUCTS.
          result.errors.push(
            `Alias for item ${l.itemNumber} -> "${aliasName}" has no catalog product and is not in CREATED_PRODUCTS (invoice ${inv.invoiceNumber}).`,
          );
          recordUnmatched(result, l, inv.branch);
          resolved.push({ line: l, productId: null, unit: l.uom, outcome: "unmatched" });
          continue;
        }
        if (!CREATED_PRODUCTS[aliasName]) result.matchedProducts.add(aliasName);
        const outcome: LineOutcome = l.qtyShipped < 0 ? "credit_adjustment" : "check_in";
        if (outcome === "credit_adjustment") {
          result.creditLines.push({
            invoiceNumber: inv.invoiceNumber,
            branch: inv.branch,
            product: aliasName,
            qty: l.qtyShipped,
            amount: l.extPrice,
          });
        }
        resolved.push({ line: l, productId: prod.id, unit: prod.unitOfMeasure, outcome });
      }

      const postable = resolved.filter((r) => r.outcome === "check_in" || r.outcome === "credit_adjustment");

      // Tally report numbers (both preview + apply).
      for (const r of postable) {
        pb.linesLoaded++;
        pb.unitsLoaded += r.line.qtyShipped;
        pb.spendLoaded += r.line.extPrice;
      }
      pb.invoicesCreated++;

      if (!opts.apply) continue;

      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            distributor: vendor,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate,
            warehouseId: warehouse.id,
            subtotal: inv.subtotalShipped ?? null,
            total: null, // tax/freight not carried in the line-item CSV
            status: "confirmed",
          },
        });
        for (const r of resolved) {
          const l = r.line;
          // Record every shipped line on the invoice for a complete audit trail.
          await tx.invoiceLine.create({
            data: {
              invoiceId: invoice.id,
              productId: r.productId,
              descriptionRaw: l.description,
              quantity: l.qtyShipped,
              unit: uomCode(l.uom) ?? r.unit ?? null,
              unitPrice: l.netUnitPrice,
              lineTotal: l.extPrice,
              matched: r.outcome === "check_in" || r.outcome === "credit_adjustment",
            },
          });
          if (r.outcome === "check_in" && r.productId) {
            await tx.stockMovement.create({
              data: {
                type: "check_in",
                productId: r.productId,
                warehouseId: warehouse.id,
                quantity: l.qtyShipped,
                unit: r.unit,
                unitPrice: l.netUnitPrice,
                sourceInvoiceId: invoice.id,
                createdAt: invoiceDate,
              },
            });
          } else if (r.outcome === "credit_adjustment" && r.productId) {
            await tx.stockMovement.create({
              data: {
                type: "adjustment",
                productId: r.productId,
                warehouseId: warehouse.id,
                quantity: l.qtyShipped, // negative
                unit: r.unit,
                unitPrice: l.netUnitPrice,
                sourceInvoiceId: invoice.id,
                reason: `SiteOne credit memo ${inv.invoiceNumber}: ${l.description}`,
                createdAt: invoiceDate,
              },
            });
          }
        }
      });
    }

    result.files.push(fr);
  }

  // Best-effort anomaly + reorder refresh after a real load (mirrors check-in).
  if (opts.apply && result.files.some((f) => Object.values(f.perBranch).some((b) => b.invoicesCreated > 0))) {
    try {
      const { runAnomalyChecks } = await import("../lib/anomaly");
      const { runReorderChecks } = await import("../lib/reorder");
      await runAnomalyChecks();
      await runReorderChecks();
    } catch {
      /* alerts are non-critical; never fail the load on their account */
    }
  }

  return result;
}

function classifyForReport(l: JsonLine, branch: string, result: LoadResult): void {
  if (SURCHARGE_ITEMS.has(l.itemNumber)) return;
  const aliasName = SITEONE_ALIASES[l.itemNumber];
  if (!aliasName) {
    recordUnmatched(result, l, branch);
    return;
  }
  if (CREATED_PRODUCTS[aliasName]) result.createdProducts.add(aliasName);
  else result.matchedProducts.add(aliasName);
}

function recordUnmatched(result: LoadResult, l: JsonLine, branch: string): void {
  const key = l.itemNumber || l.description;
  const u = result.unmatched.get(key) ?? { itemNumber: l.itemNumber, description: l.description, count: 0, branches: new Set<string>() };
  u.count++;
  u.branches.add(branch);
  result.unmatched.set(key, u);
}

function parseDate(s: string): Date {
  // JSON dates are "YYYY-MM-DD"; anchor to midday UTC for a stable calendar date.
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function printReport(r: LoadResult): void {
  console.log(`\n=== Purchase-invoice load — ${r.mode.toUpperCase()} ===`);
  for (const f of r.files) {
    console.log(`\n-- ${f.sourceFile} (${f.vendor}) | zero-shipped skipped: ${f.skippedZeroShipped}`);
    for (const [branch, b] of Object.entries(f.perBranch)) {
      console.log(
        `   [${branch}] -> ${b.warehouse} ${b.warehouseFound ? "" : "(NOT FOUND)"}\n` +
          `      invoices: ${b.invoicesCreated} loaded, ${b.invoicesSkipped} already-loaded, ${b.invoicesStopped} stopped | ` +
          `lines ${b.linesLoaded} | units ${b.unitsLoaded} | $${b.spendLoaded.toFixed(2)}`,
      );
    }
  }
  console.log(`\nProduct mapping: ${r.matchedProducts.size} matched, ${r.createdProducts.size} created, ${r.unmatched.size} unmatched item#s.`);
  if (r.createdProducts.size) console.log(`  CREATED: ${[...r.createdProducts].join(" | ")}`);
  if (r.unmatched.size) {
    console.log(`  UNMATCHED (needs review, NOT loaded):`);
    for (const u of r.unmatched.values()) console.log(`     [${u.itemNumber}] x${u.count} ${u.description}`);
  }
  console.log(`  Surcharge lines skipped: ${r.surchargeSkipped}`);
  if (r.creditLines.length) {
    console.log(`  CREDIT (negative adjustment) lines:`);
    for (const c of r.creditLines) console.log(`     ${c.invoiceNumber} [${c.branch}] ${c.product}: ${c.qty} ($${c.amount})`);
  }
  if (r.duplicateInvoiceWarnings.length) {
    console.log(`  DUPLICATE invoice warnings:`);
    for (const w of r.duplicateInvoiceWarnings) console.log(`     ${w}`);
  }
  if (r.errors.length) {
    console.log(`  ERRORS / STOPS:`);
    for (const e of r.errors) console.log(`     ${e}`);
  }
}

// Standalone CLI.
if (process.argv[1] && /load-purchase-invoices\.ts$/.test(process.argv[1])) {
  const apply = process.argv.slice(2).some((a) => a === "apply" || a === "--apply");
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const mvBefore = await prisma.stockMovement.count();
      const r = await loadPurchaseInvoices(prisma, { apply });
      printReport(r);
      const mvAfter = await prisma.stockMovement.count();
      console.log(`\nStockMovement count: ${mvBefore} -> ${mvAfter} (${apply ? "apply" : "preview — unchanged expected"}).`);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
