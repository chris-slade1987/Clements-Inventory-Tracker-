/**
 * Warehouse -> technician dispersal loader (check-outs) — PREVIEW + APPLY.
 *
 * Reads every committed dispersal JSON under prisma/data/dispersals/*.json
 * (currently the PestPac "Inventory Transfer History Report" for Aug + Sep 2026)
 * and records each transfer row as a negative `check_out` stock movement, on TOP
 * of the 7/31/2026 baseline + the SiteOne purchase check-ins. These are the
 * chemicals/materials dispersed from a branch warehouse to a technician's truck.
 *
 * CORE DATA RULE (AGENTS.md / CLAUDE.md): on-hand = SUM(StockMovement.quantity).
 * A dispersal posts a NEGATIVE `check_out` movement (quantity = -abs(qty)), dated
 * at the transfer date, matching how app/api/check-out/route.ts posts live
 * check-outs. On-hand is never mutated directly; nothing is ever hard-deleted.
 *
 * BRANCH IS PER ROW: the warehouse is resolved from each row's own `branch`
 * (PestPac "Source" column, e.g. "Vero Beach - Branch 1" -> "Vero Beach (HQ)") —
 * never assumed. A row whose branch does not resolve is NOT loaded; it's reported.
 *
 * PRODUCT MATCH: each row's `material` (PestPac material name, often truncated to
 * ~30 chars) resolves through the shared PestPac alias map
 * (lib/product-aliases.ts resolveProductAlias) to an approved catalog product. A
 * material that resolves to no catalog product is NOT loaded — reported as
 * "unmatched (needs review)". We never fabricate a product for a dispersal.
 *
 * TECHNICIAN: the PestPac "Destination" is "<card#> <NAME>" (e.g. "403 JASON").
 * The loader resolves a Technician by card # (employeeIdCard), else by exact name
 * within the source warehouse, else creates one (role Technician, active, home =
 * source warehouse) so the dispersal is attributed. The raw destination is also
 * written to the movement `reason` for the audit trail.
 *
 * NEGATIVE STOCK IS ALLOWED, NOT BLOCKED: this is a historical record of what
 * actually left the shelf. If recorded dispersals exceed baseline + receipts, the
 * resulting on-hand goes negative; that is surfaced in the report (it reveals a
 * gap in the baseline/receipts), but the real movements are still recorded.
 *
 * IDEMPOTENT per file via the `dispersal_load:<loadKey>` Setting marker (applies
 * EXACTLY ONCE per loadKey). The whole file loads in one transaction that also
 * writes the marker, so it is all-or-nothing and redeploys never double-post.
 *
 *   Preview:  DATABASE_URL=... tsx scripts/load-dispersals.ts
 *   Apply:    DATABASE_URL=... tsx scripts/load-dispersals.ts apply
 *
 * deploy-db.ts calls loadDispersals(prisma, { apply: true }) after the
 * purchase-invoice load (owner authorized an automatic apply, no manual step).
 */
import type { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveProductAlias, normalizeProductName } from "../lib/product-aliases";
import { uomCode } from "../lib/uom";

const DATA_DIR = join(process.cwd(), "prisma", "data", "dispersals");

// PestPac "Source" branch -> Warehouse.name. No default: an unrecognized branch
// stops that row (reported, never defaulted).
const BRANCH_TO_WAREHOUSE: Record<string, string> = {
  "vero beach": "Vero Beach (HQ)",
  "vero beach (hq)": "Vero Beach (HQ)",
  stuart: "Stuart",
  orlando: "Orlando",
  naples: "Naples",
};

function resolveWarehouseName(branch: string): string | null {
  return BRANCH_TO_WAREHOUSE[branch.trim().toLowerCase()] ?? null;
}

/**
 * Dispersal-local product overrides, consulted BEFORE the shared PestPac alias
 * map (lib/product-aliases.ts). Same precedent as the 7/31 reconciliation's
 * SHEET_ALIASES: a dispersal must draw stock from the SAME catalog row the 7/31
 * baseline and the SiteOne receipts booked it into, even where the catalog holds
 * near-duplicate entries.
 *
 * LESCO CrossCheck 0.069% 0-0-7 (granular): the baseline and the SiteOne receipts
 * both book this into "0-0-7 Fertilizer + Insecticide" (where all the on-hand
 * sits), while the shared alias points at the empty near-duplicate "Crosscheck
 * 0.069% Plus". We override so these dispersals draw down the row that actually
 * holds the stock. (The catalog's duplicate CrossCheck entries are a separate
 * clean-up the owner may want later.) Keys are normalizeProductName() form.
 */
const DISPERSAL_ALIASES: Record<string, string> = {
  "lesco crosscheck 0.069% 0-0-7": "0-0-7 Fertilizer + Insecticide",
};

type JsonRow = {
  date: string; // YYYY-MM-DD
  branch: string;
  techCard: string;
  techName: string;
  material: string;
  qty: number;
  unit: string;
  cost: number | null;
  by: string;
};
type JsonDoc = {
  loadKey: string;
  source: string;
  sourceFile: string;
  note?: string;
  period?: { start: string; end: string };
  rows: JsonRow[];
};

export type BranchReport = {
  warehouse: string;
  warehouseFound: boolean;
  rowsLoaded: number;
  rowsStopped: number; // branch unresolved
  rowsUnmatched: number; // product not in catalog
  unitsDispersed: number; // absolute units posted out
  valueDispersed: number; // sum of row cost posted
  technicians: Set<string>;
};
export type FileReport = {
  sourceFile: string;
  loadKey: string;
  alreadyLoaded: boolean;
  perBranch: Record<string, BranchReport>;
};
export type LoadResult = {
  mode: "preview" | "apply";
  files: FileReport[];
  matchedProducts: Set<string>;
  unmatched: Map<string, { material: string; count: number; units: number; branches: Set<string> }>;
  techsCreated: Array<{ card: string; name: string; warehouse: string }>;
  techsMatched: number; // DISTINCT pre-existing technicians that received >=1 dispersal
  negativeOnHand: Array<{ warehouse: string; product: string; endingOnHand: number }>;
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

function markerKey(loadKey: string): string {
  return `dispersal_load:${loadKey}`;
}

function parseDate(s: string): Date {
  // Anchor to local-midday UTC for a stable calendar date.
  const d = new Date(`${s}T17:00:00Z`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function recordUnmatched(result: LoadResult, row: JsonRow): void {
  const key = normalizeProductName(row.material);
  const u =
    result.unmatched.get(key) ??
    { material: row.material, count: 0, units: 0, branches: new Set<string>() };
  u.count++;
  u.units += Math.abs(row.qty);
  u.branches.add(row.branch);
  result.unmatched.set(key, u);
}

export async function loadDispersals(
  prisma: PrismaClient,
  opts: { apply: boolean } = { apply: false },
): Promise<LoadResult> {
  const docs = readDocs();
  const result: LoadResult = {
    mode: opts.apply ? "apply" : "preview",
    files: [],
    matchedProducts: new Set(),
    unmatched: new Map(),
    techsCreated: [],
    techsMatched: 0,
    negativeOnHand: [],
    errors: [],
  };

  // Catalog index by normalized name (prefer approved on collision).
  const products = await prisma.product.findMany({
    select: { id: true, name: true, approved: true, unitOfMeasure: true },
  });
  const byNorm = new Map<string, { id: string; name: string; approved: boolean; unitOfMeasure: string }>();
  for (const p of products) {
    const norm = normalizeProductName(p.name);
    const prev = byNorm.get(norm);
    if (!prev || (!prev.approved && p.approved)) byNorm.set(norm, p);
  }

  // Warehouse-name -> id, loaded once.
  const warehouses = await prisma.warehouse.findMany({ select: { id: true, name: true } });
  const whByName = new Map(warehouses.map((w) => [w.name, w.id]));

  // Technician cache: card# -> {id, warehouseId}. Seeded from existing techs so
  // we match before creating. Mutated as we create.
  const existingTechs = await prisma.technician.findMany({
    select: { id: true, name: true, homeWarehouseId: true, employeeIdCard: true },
  });
  const techByCard = new Map<string, { id: string; warehouseId: string }>();
  const techByNameWh = new Map<string, { id: string; warehouseId: string }>();
  const preexistingTechIds = new Set(existingTechs.map((t) => t.id));
  const matchedExistingIds = new Set<string>();
  for (const t of existingTechs) {
    if (t.employeeIdCard) techByCard.set(t.employeeIdCard.trim().toLowerCase(), { id: t.id, warehouseId: t.homeWarehouseId });
    techByNameWh.set(`${normalizeProductName(t.name)}::${t.homeWarehouseId}`, { id: t.id, warehouseId: t.homeWarehouseId });
  }

  // Track net on-hand delta per (warehouseId, productId) for the negative report,
  // starting from current live on-hand.
  const liveOnHand = new Map<string, number>(); // `${wh}::${pid}` -> qty
  {
    const rows = await prisma.stockMovement.groupBy({
      by: ["warehouseId", "productId"],
      _sum: { quantity: true },
    });
    for (const r of rows) liveOnHand.set(`${r.warehouseId}::${r.productId}`, r._sum.quantity ?? 0);
  }
  const productNameById = new Map(products.map((p) => [p.id, p.name]));

  for (const doc of docs) {
    const fr: FileReport = { sourceFile: doc.sourceFile, loadKey: doc.loadKey, alreadyLoaded: false, perBranch: {} };

    const marker = await prisma.setting.findUnique({ where: { key: markerKey(doc.loadKey) } }).catch(() => null);
    if (marker) {
      fr.alreadyLoaded = true;
      result.files.push(fr);
      continue;
    }

    // Resolve every row up-front (preview + apply agree), then post in one tx.
    type Resolved = { row: JsonRow; warehouseId: string; productId: string; unit: string | null; technicianId: string | null };
    const resolved: Resolved[] = [];

    for (const row of doc.rows) {
      const branchKey = row.branch || "(blank)";
      const whName = resolveWarehouseName(row.branch);
      const pb =
        fr.perBranch[branchKey] ??
        (fr.perBranch[branchKey] = {
          warehouse: whName ?? `(UNRESOLVED: ${row.branch})`,
          warehouseFound: false,
          rowsLoaded: 0,
          rowsStopped: 0,
          rowsUnmatched: 0,
          unitsDispersed: 0,
          valueDispersed: 0,
          technicians: new Set<string>(),
        });

      if (!whName) {
        pb.rowsStopped++;
        result.errors.push(`STOP: row ${row.date} ${row.material} has unresolved branch "${row.branch}" — not loaded.`);
        continue;
      }
      const warehouseId = whByName.get(whName);
      if (!warehouseId) {
        pb.rowsStopped++;
        result.errors.push(`STOP: branch "${row.branch}" -> warehouse "${whName}" not found in DB — not loaded.`);
        continue;
      }
      pb.warehouseFound = true;

      const aliasName = DISPERSAL_ALIASES[normalizeProductName(row.material)] ?? resolveProductAlias(row.material);
      const prod = aliasName ? byNorm.get(normalizeProductName(aliasName)) : undefined;
      if (!prod) {
        pb.rowsUnmatched++;
        recordUnmatched(result, row);
        continue;
      }
      result.matchedProducts.add(prod.name);

      // Resolve / create the technician.
      let tech = resolveTech(techByCard, techByNameWh, row, warehouseId);
      if (!tech) {
        if (opts.apply) {
          const created = await prisma.technician.create({
            data: { name: row.techName, homeWarehouseId: warehouseId, employeeIdCard: row.techCard, role: "Technician", active: true },
          });
          tech = { id: created.id, warehouseId };
          techByCard.set(row.techCard.trim().toLowerCase(), tech);
          techByNameWh.set(`${normalizeProductName(row.techName)}::${warehouseId}`, tech);
          result.techsCreated.push({ card: row.techCard, name: row.techName, warehouse: whName });
        } else {
          // Preview: note the would-be creation once.
          const k = row.techCard.trim().toLowerCase();
          if (!techByCard.has(k)) {
            techByCard.set(k, { id: `(new:${row.techCard})`, warehouseId });
            result.techsCreated.push({ card: row.techCard, name: row.techName, warehouse: whName });
          }
          tech = techByCard.get(k)!;
        }
      } else if (preexistingTechIds.has(tech.id)) {
        matchedExistingIds.add(tech.id);
      }

      const unit = uomCode(row.unit) ?? uomCode(prod.unitOfMeasure) ?? null;
      resolved.push({ row, warehouseId, productId: prod.id, unit, technicianId: tech.id.startsWith("(new:") ? null : tech.id });

      pb.rowsLoaded++;
      pb.unitsDispersed += Math.abs(row.qty);
      pb.valueDispersed += row.cost ?? 0;
      pb.technicians.add(`${row.techCard} ${row.techName}`);

      // Track the running on-hand for the negative report.
      const key = `${warehouseId}::${prod.id}`;
      liveOnHand.set(key, (liveOnHand.get(key) ?? 0) - Math.abs(row.qty));
    }

    if (opts.apply) {
      await prisma.$transaction(
        async (tx) => {
          for (const r of resolved) {
            const unitPrice =
              r.row.cost != null && r.row.qty ? Number((r.row.cost / Math.abs(r.row.qty)).toFixed(4)) : null;
            await tx.stockMovement.create({
              data: {
                type: "check_out",
                productId: r.productId,
                warehouseId: r.warehouseId,
                technicianId: r.technicianId,
                quantity: -Math.abs(r.row.qty),
                unit: r.unit,
                unitPrice,
                reason: `PestPac transfer ${r.row.date} to ${r.row.techCard} ${r.row.techName}${r.row.by ? ` (by ${r.row.by})` : ""}`,
                createdAt: parseDate(r.row.date),
              },
            });
          }
          await tx.setting.upsert({
            where: { key: markerKey(doc.loadKey) },
            update: { value: new Date().toISOString() },
            create: { key: markerKey(doc.loadKey), value: new Date().toISOString() },
          });
        },
        { timeout: 120_000, maxWait: 20_000 },
      );
    }

    result.files.push(fr);
  }

  result.techsMatched = matchedExistingIds.size;

  // Negative-stock report: any (warehouse, product) ending below zero.
  for (const [key, qty] of liveOnHand) {
    if (qty < -0.0001) {
      const [whId, pid] = key.split("::");
      result.negativeOnHand.push({
        warehouse: warehouses.find((w) => w.id === whId)?.name ?? whId,
        product: productNameById.get(pid) ?? pid,
        endingOnHand: Number(qty.toFixed(2)),
      });
    }
  }
  result.negativeOnHand.sort((a, b) => a.endingOnHand - b.endingOnHand);

  // Best-effort anomaly + reorder refresh after a real load (mirrors check-out).
  if (opts.apply && result.files.some((f) => !f.alreadyLoaded && Object.values(f.perBranch).some((b) => b.rowsLoaded > 0))) {
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

function resolveTech(
  byCard: Map<string, { id: string; warehouseId: string }>,
  byNameWh: Map<string, { id: string; warehouseId: string }>,
  row: JsonRow,
  warehouseId: string,
): { id: string; warehouseId: string } | null {
  const card = row.techCard.trim().toLowerCase();
  const byC = byCard.get(card);
  if (byC) return byC;
  const byN = byNameWh.get(`${normalizeProductName(row.techName)}::${warehouseId}`);
  if (byN) return byN;
  return null;
}

function printReport(r: LoadResult): void {
  console.log(`\n=== Dispersal (check-out) load — ${r.mode.toUpperCase()} ===`);
  for (const f of r.files) {
    console.log(`\n-- ${f.sourceFile} [${f.loadKey}]${f.alreadyLoaded ? " — ALREADY LOADED (skipped)" : ""}`);
    for (const [branch, b] of Object.entries(f.perBranch)) {
      console.log(
        `   [${branch}] -> ${b.warehouse} ${b.warehouseFound ? "" : "(NOT FOUND)"}\n` +
          `      rows ${b.rowsLoaded} loaded, ${b.rowsUnmatched} unmatched, ${b.rowsStopped} stopped | ` +
          `units -${b.unitsDispersed.toFixed(2)} | $${b.valueDispersed.toFixed(2)} | ${b.technicians.size} techs`,
      );
    }
  }
  console.log(
    `\nProduct mapping: ${r.matchedProducts.size} matched, ${r.unmatched.size} unmatched material(s).`,
  );
  if (r.unmatched.size) {
    console.log(`  UNMATCHED (needs review, NOT loaded):`);
    for (const u of r.unmatched.values())
      console.log(`     x${u.count} (${u.units} units) ${u.material} [${[...u.branches].join(", ")}]`);
  }
  console.log(`\nTechnicians: ${r.techsMatched} matched existing, ${r.techsCreated.length} created.`);
  if (r.techsCreated.length)
    console.log(`  CREATED: ${r.techsCreated.map((t) => `${t.card} ${t.name} (${t.warehouse})`).join(" | ")}`);
  if (r.negativeOnHand.length) {
    console.log(`\n  NEGATIVE on-hand after load (baseline/receipts gap — still recorded):`);
    for (const n of r.negativeOnHand) console.log(`     ${n.warehouse}: ${n.product} = ${n.endingOnHand}`);
  }
  if (r.errors.length) {
    console.log(`\n  ERRORS / STOPS:`);
    for (const e of r.errors) console.log(`     ${e}`);
  }
}

// Standalone CLI.
if (process.argv[1] && /load-dispersals\.ts$/.test(process.argv[1])) {
  const apply = process.argv.slice(2).some((a) => a === "apply" || a === "--apply");
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const mvBefore = await prisma.stockMovement.count();
      const r = await loadDispersals(prisma, { apply });
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
