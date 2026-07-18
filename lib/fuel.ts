import { prisma } from "@/lib/prisma";
import { readXlsxGrids, gridRows } from "@/lib/xlsx";

// Coast fuel-card statements. Each .xlsx is one monthly statement: a small
// header block, then a transaction table (header row contains "Vehicle" and
// "License Plate"). Rows are either vehicle fuel purchases or account-level
// entries (subscription fees, auto-payments, rebates, disputed credits).

export type RawFuelRow = {
  rowNumber: number;
  date: string;
  time: string;
  driver: string;
  vehicleField: string; // Coast "Vehicle" column — a unit number or a nickname
  merchant: string;
  description: string;
  type: string;
  amount: number;
  category: string;
  cardId: string;
  cardLast4: string;
  plate: string;
  gallons: number | null;
  costPerGallon: number | null;
  fuelGrade: string;
  odometer: number | null;
  calculatedMpg: number | null;
  mileageDriven: number | null;
  branch: string;
};

export type ParsedStatement = {
  statementNumber: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  rows: RawFuelRow[];
};

const clean = (s: string | undefined) => (s ?? "").trim();
const num = (s: string | undefined) => {
  const t = clean(s).replace(/[$,]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const intOf = (s: string | undefined) => {
  const n = num(s);
  return n === null ? null : Math.round(n);
};
const mdY = (s: string): Date | null => {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
};

/** Parse one Coast statement workbook (first sheet) into header + rows. */
export function parseCoastStatement(buf: Uint8Array): ParsedStatement {
  const grid = readXlsxGrids(buf)[0]?.grid;
  if (!grid) return { statementNumber: "", periodStart: null, periodEnd: null, rows: [] };
  const rows = gridRows(grid);

  const findLabel = (label: string) => rows.find((r) => clean(r.cells.get(0)) === label)?.cells.get(2);
  const statementNumber = clean(findLabel("Statement Number:")) || clean(findLabel("Account Number:"));
  const periodText = clean(findLabel("Coast Statement:"));
  const [ps, pe] = periodText.split(" - ").map((x) => mdY(x));

  const headerRow = rows.find(
    (r) => [...r.cells.values()].includes("Vehicle") && [...r.cells.values()].includes("License Plate"),
  );
  const out: RawFuelRow[] = [];
  if (headerRow) {
    const col = new Map<string, number>();
    headerRow.cells.forEach((v, c) => col.set(clean(v), c));
    const g = (r: Map<number, string>, name: string) => clean(r.get(col.get(name) ?? -1));

    for (const { r, cells } of rows) {
      if (r <= headerRow.r) continue;
      const date = g(cells, "Date");
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) continue; // skip blanks/subtotals
      out.push({
        rowNumber: r,
        date,
        time: g(cells, "Time (US/Eastern)"),
        driver: g(cells, "User"),
        vehicleField: g(cells, "Vehicle"),
        merchant: g(cells, "Merchant Name"),
        description: g(cells, "Description"),
        type: g(cells, "Type") || "Purchase",
        amount: num(g(cells, "Amount")) ?? 0,
        category: g(cells, "Category"),
        cardId: g(cells, "Card ID"),
        cardLast4: g(cells, "Card Last Four"),
        plate: g(cells, "License Plate"),
        gallons: num(g(cells, "Gallons")),
        costPerGallon: num(g(cells, "Cost Per Gallon")),
        fuelGrade: g(cells, "Fuel Grade"),
        odometer: intOf(g(cells, "Odometer")),
        calculatedMpg: num(g(cells, "Calculated MPG")),
        mileageDriven: intOf(g(cells, "Mileage Driven")),
        branch: g(cells, "Vehicle Location") || g(cells, "User Location"),
      });
    }
  }
  return { statementNumber, periodStart: ps ?? null, periodEnd: pe ?? null, rows: out };
}

// ---- Vehicle matching -----------------------------------------------------
//
// The reliable link is Coast's own UNIT NUMBER — it's recorded per transaction
// and every Coast unit maps 1:1 to a fleet unit number. Two wrinkles: (1) about
// half the rows put a driver name/nickname in the "Vehicle" column instead of a
// unit number, and (2) our registry's plate + fuel-card fields are stale/
// misaligned and fuel cards physically move between trucks — so neither can be
// trusted as a primary key. We therefore learn Coast's *internal* plate→unit
// and card→unit mapping from the rows that DO carry a numeric unit, then use it
// to resolve the name rows back to a unit. Everything keys off unit number, the
// one field that lines up between Coast and our fleet.

const normKey = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/\s+/g, "");
const isNumericUnit = (s: string | null | undefined) => /^\d+$/.test((s ?? "").trim());

export type VehicleMatchRow = {
  id: string;
  unitNumber: string | null;
  plate: string | null;
  driverCard: string | null;
};

/** Coast's self-consistent maps (dominant unit per plate / per card), learned
 *  from statement rows that carry a numeric unit number. */
export type CoastCorpus = {
  plateToUnit: Map<string, string>;
  cardToUnit: Map<string, string>;
};

export function buildCoastCorpus(rows: RawFuelRow[]): CoastCorpus {
  const plate = new Map<string, Map<string, number>>();
  const card = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, k: string, unit: string) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, new Map());
    m.get(k)!.set(unit, (m.get(k)!.get(unit) ?? 0) + 1);
  };
  for (const r of rows) {
    if (!isNumericUnit(r.vehicleField)) continue;
    const unit = normKey(r.vehicleField);
    bump(plate, normKey(r.plate), unit);
    bump(card, normKey(r.cardId), unit);
  }
  const dominant = (m: Map<string, Map<string, number>>) => {
    const out = new Map<string, string>();
    for (const [k, counts] of m) {
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) out.set(k, top[0]);
    }
    return out;
  };
  return { plateToUnit: dominant(plate), cardToUnit: dominant(card) };
}

/** unit number (normalized) → fleet vehicle. */
export function buildUnitIndex(vehicles: VehicleMatchRow[]): Map<string, VehicleMatchRow> {
  const m = new Map<string, VehicleMatchRow>();
  for (const v of vehicles) if (v.unitNumber) m.set(normKey(v.unitNumber), v);
  return m;
}

export type MatchResult = { vehicleId: string | null; method: string; coastUnit: string | null };

/**
 * Resolve a statement row to a fleet vehicle via Coast's authoritative unit
 * number: use it directly when present, else recover it from the plate, else
 * the card. Account-level rows (fees, auto-payments, rebates) carry no vehicle.
 */
export function matchVehicle(row: RawFuelRow, corpus: CoastCorpus, unitIndex: Map<string, VehicleMatchRow>): MatchResult {
  const accountish = /^(fee|credit|bill payment)$/i.test(row.type) || normKey(row.merchant) === "COAST";

  let coastUnit: string | null = null;
  let method = "none";
  if (isNumericUnit(row.vehicleField)) {
    coastUnit = normKey(row.vehicleField);
    method = "unit";
  } else if (row.plate && corpus.plateToUnit.has(normKey(row.plate))) {
    coastUnit = corpus.plateToUnit.get(normKey(row.plate))!;
    method = "plate";
  } else if (row.cardId && corpus.cardToUnit.has(normKey(row.cardId))) {
    coastUnit = corpus.cardToUnit.get(normKey(row.cardId))!;
    method = "card";
  }

  if (coastUnit && unitIndex.has(coastUnit)) {
    return { vehicleId: unitIndex.get(coastUnit)!.id, method, coastUnit };
  }
  if (accountish) return { vehicleId: null, method: "account", coastUnit: null };
  return { vehicleId: null, method: "none", coastUnit };
}

/** Stable per-row key so re-importing a statement never duplicates rows. */
export function fuelDedupeKey(statementNumber: string, row: RawFuelRow): string {
  return `${statementNumber || "stmt"}#${row.rowNumber}`;
}

// ---- Rollups for the UI ---------------------------------------------------

export type VehicleFuelSummary = {
  totalSpend: number;
  totalGallons: number;
  txCount: number;
  avgMpg: number | null;
  avgCostPerGallon: number | null;
  lastFuelDate: Date | null;
  lastOdometer: number | null;
};

// Coast's Calculated MPG depends on drivers keying the odometer at the pump; a
// mistyped reading yields wild values (200+, or near-0). Only average readings
// in a physically plausible range for a work truck so fleet MPG stays honest.
export const PLAUSIBLE_MPG = (x: number | null | undefined): x is number => x != null && x >= 2 && x <= 40;
// Guard the $/gallon average too: some rows record a token 0.1 gal on a $60
// charge (DEF/additive or a mis-keyed pump), yielding $400+/gal that would wreck
// the average. Keep readings in a sane retail range.
export const PLAUSIBLE_CPG = (x: number | null | undefined): x is number => x != null && x >= 1.5 && x <= 8;

/** Summarize a vehicle's linked purchases (positive fuel spend only). */
export function summarizeVehicleFuel(rows: { amount: number; gallons: number | null; costPerGallon: number | null; calculatedMpg: number | null; date: Date; odometer: number | null; type: string }[]): VehicleFuelSummary {
  const purchases = rows.filter((r) => r.type === "Purchase" || r.amount > 0);
  const totalSpend = purchases.reduce((s, r) => s + r.amount, 0);
  const totalGallons = purchases.reduce((s, r) => s + (r.gallons ?? 0), 0);
  const mpgs = purchases.map((r) => r.calculatedMpg).filter(PLAUSIBLE_MPG);
  const cpgs = purchases.map((r) => r.costPerGallon).filter(PLAUSIBLE_CPG);
  const sorted = [...purchases].sort((a, b) => b.date.getTime() - a.date.getTime());
  const withOdo = sorted.find((r) => r.odometer != null);
  return {
    totalSpend,
    totalGallons,
    txCount: purchases.length,
    avgMpg: mpgs.length ? mpgs.reduce((s, x) => s + x, 0) / mpgs.length : null,
    avgCostPerGallon: cpgs.length ? cpgs.reduce((s, x) => s + x, 0) / cpgs.length : null,
    lastFuelDate: sorted[0]?.date ?? null,
    lastOdometer: withOdo?.odometer ?? null,
  };
}

export async function vehicleFuel(vehicleId: string, take = 50) {
  const rows = await prisma.fuelTransaction.findMany({
    where: { vehicleId },
    orderBy: { date: "desc" },
    take,
  });
  return { rows, summary: summarizeVehicleFuel(rows) };
}

// ---- Upload / ingest ------------------------------------------------------

export type IngestResult = {
  ok: boolean;
  error?: string;
  statementNumber: string;
  period: string;
  total: number;
  purchases: number;
  linked: number;
  account: number;
  unlinked: number;
  created: number;
  updated: number;
  unlinkedSamples: string[];
};

/**
 * Parse and store one uploaded Coast statement, linking each purchase to a
 * vehicle. The matching corpus is seeded from this statement's own numbered
 * rows AND from everything already imported (each existing linked row teaches
 * plate→unit / card→unit), so even a statement that's mostly driver-name rows
 * links cleanly. Idempotent: re-uploading the same statement updates in place.
 */
export async function ingestCoastStatement(buf: Uint8Array): Promise<IngestResult> {
  const empty = { ok: false, statementNumber: "", period: "", total: 0, purchases: 0, linked: 0, account: 0, unlinked: 0, created: 0, updated: 0, unlinkedSamples: [] as string[] };
  const stmt = parseCoastStatement(buf);
  if (stmt.rows.length === 0) {
    return { ...empty, error: "No transactions found. Make sure this is a Coast statement export (.xlsx)." };
  }

  const vehicles = await prisma.vehicle.findMany({ select: { id: true, unitNumber: true, plate: true, driverCard: true } });
  const unitIndex = buildUnitIndex(vehicles);

  // Corpus from this statement, enriched with what we already know from prior imports.
  const corpus = buildCoastCorpus(stmt.rows);
  const priorLinked = await prisma.fuelTransaction.findMany({
    where: { vehicleId: { not: null } },
    select: { plate: true, cardId: true, vehicle: { select: { unitNumber: true } } },
  });
  for (const r of priorLinked) {
    const unit = normKey(r.vehicle?.unitNumber);
    if (!unit) continue;
    const p = normKey(r.plate);
    const c = normKey(r.cardId);
    if (p && !corpus.plateToUnit.has(p)) corpus.plateToUnit.set(p, unit);
    if (c && !corpus.cardToUnit.has(c)) corpus.cardToUnit.set(c, unit);
  }

  let linked = 0, account = 0, unlinked = 0, created = 0, updated = 0, purchases = 0;
  const unlinkedSamples: string[] = [];

  for (const row of stmt.rows) {
    const { vehicleId, method } = matchVehicle(row, corpus, unitIndex);
    const isPurchase = row.type === "Purchase" || (method !== "account" && row.amount > 0);
    if (isPurchase) purchases++;
    if (vehicleId) linked++;
    else if (method === "account") account++;
    else {
      unlinked++;
      if (unlinkedSamples.length < 8) unlinkedSamples.push(`${row.date} · ${row.driver || "?"} · veh "${row.vehicleField}" · ${row.merchant} · $${row.amount}`);
    }

    const dm = row.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const rowDate = dm ? new Date(Date.UTC(Number(dm[3]), Number(dm[1]) - 1, Number(dm[2]))) : new Date();
    const dedupeKey = fuelDedupeKey(stmt.statementNumber || "upload", row);
    const data = {
      vehicleId,
      date: rowDate,
      postedTime: row.time || null,
      driverName: row.driver || null,
      merchant: row.merchant || null,
      description: row.description || null,
      type: row.type || "Purchase",
      category: row.category || null,
      amount: row.amount,
      gallons: row.gallons,
      costPerGallon: row.costPerGallon,
      fuelGrade: row.fuelGrade || null,
      odometer: row.odometer,
      calculatedMpg: row.calculatedMpg,
      mileageDriven: row.mileageDriven,
      cardId: row.cardId || null,
      cardLast4: row.cardLast4 || null,
      plate: row.plate || null,
      branch: row.branch || null,
      matchMethod: method,
      statementNumber: stmt.statementNumber || null,
      periodStart: stmt.periodStart,
      periodEnd: stmt.periodEnd,
    };
    const existing = await prisma.fuelTransaction.findUnique({ where: { dedupeKey }, select: { id: true } });
    await prisma.fuelTransaction.upsert({ where: { dedupeKey }, create: { dedupeKey, ...data }, update: data });
    if (existing) updated++; else created++;
  }

  const fmt = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "?");
  return {
    ok: true,
    statementNumber: stmt.statementNumber,
    period: `${fmt(stmt.periodStart)} – ${fmt(stmt.periodEnd)}`,
    total: stmt.rows.length,
    purchases,
    linked,
    account,
    unlinked,
    created,
    updated,
    unlinkedSamples,
  };
}

export type FleetFuelRow = {
  id: string;
  date: string; // ISO
  amount: number;
  gallons: number | null;
  costPerGallon: number | null;
  calculatedMpg: number | null;
  type: string;
  vehicleId: string;
  unit: string | null;
  name: string;
  year: number | null;
  branch: string | null;
};

/**
 * Rows for the interactive fleet fuel dashboard: every linked purchase (so the
 * client can filter by date range) plus the full-history month trend and
 * account-level fee/rebate totals (which stay period-agnostic as context).
 */
export async function fleetFuelRows(branch?: string | null) {
  // Filter by the LINKED VEHICLE's branch (our normalized key), not the row's
  // own branch text — Coast writes "Vero Beach", the app uses "vero".
  const linkedWhere = branch ? { vehicleId: { not: null }, vehicle: { branch } } : { vehicleId: { not: null } };
  const [linked, account] = await Promise.all([
    prisma.fuelTransaction.findMany({
      where: linkedWhere,
      select: { id: true, date: true, amount: true, gallons: true, costPerGallon: true, calculatedMpg: true, type: true, vehicle: { select: { id: true, unitNumber: true, name: true, year: true, branch: true } } },
      orderBy: { date: "desc" },
    }),
    // Account-level rows (subscription fees, auto-payments, rebates) are company-
    // wide, not per branch — only shown when viewing all branches.
    branch ? Promise.resolve([]) : prisma.fuelTransaction.findMany({ where: { vehicleId: null }, select: { type: true, amount: true } }),
  ]);

  const rows: FleetFuelRow[] = linked
    .filter((r) => r.vehicle)
    .map((r) => ({
      id: r.id,
      date: r.date.toISOString(),
      amount: r.amount,
      gallons: r.gallons,
      costPerGallon: r.costPerGallon,
      calculatedMpg: r.calculatedMpg,
      type: r.type,
      vehicleId: r.vehicle!.id,
      unit: r.vehicle!.unitNumber,
      name: r.vehicle!.name,
      year: r.vehicle!.year ?? null,
      branch: r.vehicle!.branch,
    }));

  const purchases = linked.filter((r) => r.type === "Purchase" || r.amount > 0);
  const byMonth = new Map<string, number>();
  for (const r of purchases) {
    const k = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, "0")}`;
    byMonth.set(k, (byMonth.get(k) ?? 0) + r.amount);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, spend]) => ({ month, spend }));
  const fees = account.filter((r) => r.type === "Fee").reduce((s, r) => s + r.amount, 0);
  const rebates = account.filter((r) => r.type === "Credit").reduce((s, r) => s + r.amount, 0);

  return { rows, months, fees, rebates };
}

/** Fleet-wide fuel overview for a period-agnostic dashboard. */
export async function fleetFuelOverview(branch?: string | null) {
  // Scope by the linked vehicle's branch key (Coast stores "Vero Beach", the app
  // uses "vero"); account-level rows are company-wide, shown only for all-branch.
  const linkedWhere = branch ? { vehicleId: { not: null }, vehicle: { branch } } : { vehicleId: { not: null } };
  const [linked, account] = await Promise.all([
    prisma.fuelTransaction.findMany({
      where: linkedWhere,
      include: { vehicle: { select: { id: true, unitNumber: true, name: true, branch: true } } },
    }),
    branch ? Promise.resolve([]) : prisma.fuelTransaction.findMany({ where: { vehicleId: null } }),
  ]);

  const purchases = linked.filter((r) => r.type === "Purchase" || r.amount > 0);
  const totalSpend = purchases.reduce((s, r) => s + r.amount, 0);
  const totalGallons = purchases.reduce((s, r) => s + (r.gallons ?? 0), 0);

  // Per-vehicle rollup.
  const byVeh = new Map<string, { name: string; unit: string | null; branch: string | null; spend: number; gallons: number; count: number; mpgs: number[] }>();
  for (const r of purchases) {
    if (!r.vehicle) continue;
    const k = r.vehicle.id;
    if (!byVeh.has(k)) byVeh.set(k, { name: r.vehicle.name, unit: r.vehicle.unitNumber, branch: r.vehicle.branch, spend: 0, gallons: 0, count: 0, mpgs: [] });
    const e = byVeh.get(k)!;
    e.spend += r.amount;
    e.gallons += r.gallons ?? 0;
    e.count += 1;
    if (PLAUSIBLE_MPG(r.calculatedMpg)) e.mpgs.push(r.calculatedMpg);
  }
  const vehicles = [...byVeh.entries()]
    .map(([id, e]) => ({ id, name: e.name, unit: e.unit, branch: e.branch, spend: e.spend, gallons: e.gallons, count: e.count, avgMpg: e.mpgs.length ? e.mpgs.reduce((s, x) => s + x, 0) / e.mpgs.length : null }))
    .sort((a, b) => b.spend - a.spend);

  // Per-month spend.
  const byMonth = new Map<string, number>();
  for (const r of purchases) {
    const k = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, "0")}`;
    byMonth.set(k, (byMonth.get(k) ?? 0) + r.amount);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, spend]) => ({ month, spend }));

  const fees = account.filter((r) => r.type === "Fee").reduce((s, r) => s + r.amount, 0);
  const rebates = account.filter((r) => r.type === "Credit").reduce((s, r) => s + r.amount, 0); // negative

  return {
    totalSpend,
    totalGallons,
    txCount: purchases.length,
    vehicleCount: vehicles.length,
    fees,
    rebates,
    vehicles,
    months,
  };
}
