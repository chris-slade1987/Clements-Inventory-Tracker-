import { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  demoId,
  isDemoMode,
  DEMO_MARKER,
  DEMO_GPS_PREFIX,
  DEMO_BRANCH_WAREHOUSE,
  DEMO_BRANCH_CENTER,
} from "../lib/demo";

// ---------------------------------------------------------------------------
// Demo Mode dataset. An idempotent, RE-RUNNABLE cross-module seed for live
// leadership demos: technicians + inventory movements, sample-GPS vehicles +
// fuel, employees + a candidate mid-pipeline, a PTO request, an absence, and a
// bulletin post. Everything is NON-SENSITIVE and obviously-demo (names carry a
// "Demo —" prefix / [DEMO] marker), and NO compensation/salary figures appear
// anywhere.
//
// Isolation: every row is written with a stable `demo_`-prefixed id (GPS sample
// rows additionally use the SAMPLE:demo_ verizonNumber prefix), so:
//   • seedDemo()  — upserts by id; safe to re-run, never duplicates, never
//                   touches real (cuid-id) rows.
//   • resetDemo() — clears ONLY demo-marked rows, then reseeds. GUARDED: refuses
//                   to run unless demo mode is on (isDemoMode()).
//
// This deliberately keeps its own `demo_`-id hiring rows separate from the
// existing seed-ats-demo.ts pipeline (which markers by applyToken + @example.com
// emails), so a reset here never disturbs that walkthrough.
// ---------------------------------------------------------------------------

const now = () => Date.now();
const daysAgo = (n: number) => new Date(now() - n * 864e5);
const daysFromNow = (n: number) => new Date(now() + n * 864e5);

export type DemoSeedSummary = {
  warehouses: number;
  products: number;
  technicians: number;
  movements: number;
  vehicles: number;
  gpsPositions: number;
  gpsTrips: number;
  fuel: number;
  employees: number;
  job: number;
  candidates: number;
  interviews: number;
  pto: number;
  absences: number;
  bulletin: number;
};

// ---- Static demo spec -----------------------------------------------------

// Dedicated demo products (kept separate from the real catalog so a reset fully
// removes them and real on-hand math is never perturbed). unitOfMeasure mirrors
// the plain values used in seed-core.
const DEMO_PRODUCTS: Array<{
  key: string;
  name: string;
  manufacturer: string;
  unit: string;
  category: string;
  division: string;
  subdivision: string;
}> = [
  { key: "talstar", name: "Demo — Talstar P Professional", manufacturer: "FMC", unit: "gallon", category: "General Pest", division: "GHP", subdivision: "General Insecticide" },
  { key: "termidor", name: "Demo — Termidor SC", manufacturer: "BASF", unit: "bottle", category: "Termiticide", division: "TERMITE", subdivision: "Liquid" },
  { key: "advion", name: "Demo — Advion Cockroach Gel", manufacturer: "Syngenta", unit: "box", category: "General Pest", division: "GHP", subdivision: "Bait" },
  { key: "contrac", name: "Demo — Contrac Blox", manufacturer: "Bell Labs", unit: "pail", category: "Rodent", division: "RODENT", subdivision: "Bait" },
];

// Demo technicians (pick-list only; no logins).
const DEMO_TECHS: Array<{ key: string; name: string; branch: string; card: string }> = [
  { key: "1", name: "Demo — Alex Rivera", branch: "vero", card: "DEMO-1001" },
  { key: "2", name: "Demo — Jordan Blake", branch: "stuart", card: "DEMO-2001" },
  { key: "3", name: "Demo — Sam Ortiz", branch: "orlando", card: "DEMO-3001" },
];

// Demo vehicles (active, sample GPS only — the live Verizon feed is never used).
const DEMO_VEHICLES: Array<{
  key: string;
  name: string;
  branch: string;
  unit: string;
  plate: string;
  vin: string;
  mileage: number;
  assignedTo: string;
}> = [
  { key: "1", name: "Demo — 2021 Ford Transit 250", branch: "vero", unit: "DEMO-01", plate: "DEMO101", vin: "DEMOVIN0000000001", mileage: 58200, assignedTo: "Demo — Alex Rivera" },
  { key: "2", name: "Demo — 2020 Chevy Express", branch: "stuart", unit: "DEMO-02", plate: "DEMO102", vin: "DEMOVIN0000000002", mileage: 71450, assignedTo: "Demo — Jordan Blake" },
  { key: "3", name: "Demo — 2022 Ram ProMaster", branch: "orlando", unit: "DEMO-03", plate: "DEMO103", vin: "DEMOVIN0000000003", mileage: 43310, assignedTo: "Demo — Sam Ortiz" },
];

// Demo employees (personnel profiles; NO compensation anywhere).
const DEMO_EMPLOYEES: Array<{
  key: string;
  name: string;
  branch: string;
  role: string;
  division: string;
  hireDate: string;
  birthMonth: number;
  birthDay: number;
}> = [
  { key: "1", name: "Demo — Taylor Green", branch: "vero", role: "Technician", division: "General Pest", hireDate: "2023-03-14", birthMonth: 8, birthDay: 9 },
  { key: "2", name: "Demo — Morgan Lee", branch: "stuart", role: "Manager", division: "Service", hireDate: "2019-06-03", birthMonth: 8, birthDay: 21 },
  { key: "3", name: "Demo — Casey Kim", branch: "orlando", role: "Technician", division: "Lawn", hireDate: "2024-01-22", birthMonth: 9, birthDay: 2 },
];

// Deterministic pseudo-random in [0,1) from a string seed (mirrors lib/gps.ts).
function seeded(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Clear (demo rows only) ----------------------------------------------

/**
 * Delete ONLY demo-marked rows (id prefix `demo_`, plus SAMPLE:demo_ GPS rows).
 * Ordered children-first so foreign keys never block a delete. Never touches a
 * real (cuid-id) row. Safe to call repeatedly.
 */
export async function clearDemoRows(client: PrismaClient = prisma): Promise<void> {
  const idPrefix = { id: { startsWith: "demo_" } };
  // Hiring: interviews -> candidates -> job.
  await client.interview.deleteMany({ where: idPrefix });
  await client.candidate.deleteMany({ where: idPrefix });
  await client.job.deleteMany({ where: idPrefix });
  // People-linked records (also covered by cascade, cleared explicitly first).
  await client.ptoRequest.deleteMany({ where: idPrefix });
  await client.absence.deleteMany({ where: idPrefix });
  // Inventory movements before their products/technicians.
  await client.stockMovement.deleteMany({ where: idPrefix });
  // GPS (no demo_ id — keyed by verizonNumber prefix) before vehicles.
  await client.gpsPosition.deleteMany({ where: { verizonNumber: { startsWith: DEMO_GPS_PREFIX } } });
  await client.gpsTrip.deleteMany({ where: { verizonNumber: { startsWith: DEMO_GPS_PREFIX } } });
  await client.fuelTransaction.deleteMany({ where: idPrefix });
  await client.bulletinPost.deleteMany({ where: idPrefix });
  // Now the parents.
  await client.vehicle.deleteMany({ where: idPrefix });
  await client.technician.deleteMany({ where: idPrefix });
  await client.employee.deleteMany({ where: idPrefix });
  await client.product.deleteMany({ where: idPrefix });
}

// ---- Seed -----------------------------------------------------------------

/**
 * Build the demo dataset. Idempotent: everything is upserted by a stable
 * `demo_` id, so re-running updates in place and never duplicates. Real data is
 * never modified. Returns per-module counts. Non-destructive — the reset path is
 * resetDemo().
 */
export async function seedDemo(client: PrismaClient = prisma): Promise<DemoSeedSummary> {
  const summary: DemoSeedSummary = {
    warehouses: 0, products: 0, technicians: 0, movements: 0, vehicles: 0,
    gpsPositions: 0, gpsTrips: 0, fuel: 0, employees: 0, job: 0, candidates: 0,
    interviews: 0, pto: 0, absences: 0, bulletin: 0,
  };

  // Resolve the branch warehouses we need (skip a branch cleanly if missing).
  const warehouseByBranch = new Map<string, string>();
  for (const [branch, name] of Object.entries(DEMO_BRANCH_WAREHOUSE)) {
    const wh = await client.warehouse.findFirst({ where: { name }, select: { id: true } });
    if (wh) {
      warehouseByBranch.set(branch, wh.id);
      summary.warehouses++;
    }
  }

  // --- Products -------------------------------------------------------
  const productId: Record<string, string> = {};
  for (const p of DEMO_PRODUCTS) {
    const id = demoId("prod", p.key);
    const data = {
      name: p.name,
      manufacturer: p.manufacturer,
      unitOfMeasure: p.unit,
      category: p.category,
      division: p.division,
      subdivision: p.subdivision,
      approved: true,
      confirmed: true,
      notes: `${DEMO_MARKER} sample product — safe to delete.`,
    };
    await client.product.upsert({ where: { id }, create: { id, ...data }, update: data });
    productId[p.key] = id;
    summary.products++;
  }

  // --- Technicians ----------------------------------------------------
  const techId: Record<string, string> = {};
  for (const t of DEMO_TECHS) {
    const home = warehouseByBranch.get(t.branch);
    if (!home) continue;
    const id = demoId("tech", t.key);
    const data = {
      name: t.name,
      homeWarehouseId: home,
      employeeIdCard: t.card,
      role: "Technician",
      active: true,
    };
    await client.technician.upsert({ where: { id }, create: { id, ...data }, update: data });
    techId[t.key] = id;
    summary.technicians++;
  }

  // --- Stock movements (check-in history + check-outs) ----------------
  // Net positive per product/warehouse so nothing goes negative; the Contrac
  // pail at Vero is deliberately drawn down low so it surfaces in reorder views.
  type Mv = {
    key: string; type: "check_in" | "check_out"; product: string; branch: string;
    qty: number; tech?: string; days: number; price?: number;
  };
  const MOVES: Mv[] = [
    // Vero check-ins.
    { key: "v_in_talstar", type: "check_in", product: "talstar", branch: "vero", qty: 20, days: 12, price: 62.0 },
    { key: "v_in_termidor", type: "check_in", product: "termidor", branch: "vero", qty: 12, days: 14, price: 78.5 },
    { key: "v_in_advion", type: "check_in", product: "advion", branch: "vero", qty: 30, days: 10, price: 34.25 },
    { key: "v_in_contrac", type: "check_in", product: "contrac", branch: "vero", qty: 6, days: 11, price: 41.5 },
    // Vero check-outs.
    { key: "v_out_talstar", type: "check_out", product: "talstar", branch: "vero", qty: 4, tech: "1", days: 3 },
    { key: "v_out_advion", type: "check_out", product: "advion", branch: "vero", qty: 8, tech: "1", days: 2 },
    { key: "v_out_contrac", type: "check_out", product: "contrac", branch: "vero", qty: 5, tech: "1", days: 1 }, // leaves 1 -> low stock
    // Stuart.
    { key: "s_in_talstar", type: "check_in", product: "talstar", branch: "stuart", qty: 10, days: 6, price: 63.5 },
    { key: "s_out_talstar", type: "check_out", product: "talstar", branch: "stuart", qty: 2, tech: "2", days: 1 },
    // Orlando.
    { key: "o_in_termidor", type: "check_in", product: "termidor", branch: "orlando", qty: 8, days: 8, price: 80.0 },
    { key: "o_out_termidor", type: "check_out", product: "termidor", branch: "orlando", qty: 3, tech: "3", days: 1 },
  ];
  for (const m of MOVES) {
    const wh = warehouseByBranch.get(m.branch);
    const pid = productId[m.product];
    if (!wh || !pid) continue;
    const id = demoId("mv", m.key);
    const tId = m.tech ? techId[m.tech] ?? null : null;
    const data = {
      type: m.type,
      productId: pid,
      warehouseId: wh,
      technicianId: m.type === "check_out" ? tId : null,
      quantity: m.type === "check_out" ? -Math.abs(m.qty) : Math.abs(m.qty),
      unitPrice: m.price ?? null,
      reason: `${DEMO_MARKER} ${m.type === "check_in" ? "received (demo)" : "checked out (demo)"}`,
      createdAt: daysAgo(m.days),
    };
    await client.stockMovement.upsert({ where: { id }, create: { id, ...data }, update: data });
    summary.movements++;
  }

  // --- Vehicles + sample GPS + fuel -----------------------------------
  const vehicleId: Record<string, string> = {};
  for (const v of DEMO_VEHICLES) {
    const id = demoId("veh", v.key);
    const data = {
      unitNumber: v.unit,
      name: v.name,
      branch: v.branch,
      plate: v.plate,
      vin: v.vin,
      assignedTo: v.assignedTo,
      status: "active",
      currentMileage: v.mileage,
      mileageAsOf: daysAgo(1),
      gps: "SAMPLE",
      statusNotes: `${DEMO_MARKER} demo vehicle`,
    };
    await client.vehicle.upsert({ where: { id }, create: { id, ...data }, update: data });
    vehicleId[v.key] = id;
    summary.vehicles++;
  }

  // GPS: clear this run's demo sample rows, then regenerate (mirrors the sample
  // generator in lib/gps.ts so the Live Map shows demo vehicles without Verizon).
  await client.gpsPosition.deleteMany({ where: { verizonNumber: { startsWith: DEMO_GPS_PREFIX } } });
  await client.gpsTrip.deleteMany({ where: { verizonNumber: { startsWith: DEMO_GPS_PREFIX } } });
  const SAMPLE_POINTS = 6;
  const t0 = now();
  for (const v of DEMO_VEHICLES) {
    const vid = vehicleId[v.key];
    if (!vid) continue;
    const verizonNumber = `${DEMO_GPS_PREFIX}veh_${v.key}`;
    const center = DEMO_BRANCH_CENTER[v.branch] ?? DEMO_BRANCH_CENTER.vero;
    const moving = seeded(vid, 7) > 0.45;
    for (let i = SAMPLE_POINTS - 1; i >= 0; i--) {
      const ts = new Date(t0 - i * 12 * 60 * 1000);
      const isLatest = i === 0;
      const speed = isLatest ? (moving ? Math.round(8 + seeded(vid, 11) * 45) : 0) : Math.round(seeded(vid, i * 5) * 40);
      await client.gpsPosition.create({
        data: {
          id: demoId("gpspos", v.key, i),
          vehicleId: vid,
          verizonNumber,
          ts,
          lat: center.lat + (seeded(vid, i * 3 + 1) - 0.5) * 0.06,
          lng: center.lng + (seeded(vid, i * 3 + 2) - 0.5) * 0.06,
          speed,
          heading: Math.round(seeded(vid, i * 7) * 360),
          address: `${cap(v.branch)}, FL (demo)`,
          ignition: isLatest ? moving : speed > 0,
          odometer: v.mileage + (SAMPLE_POINTS - i) * 2,
          sample: true,
        },
      });
      summary.gpsPositions++;
    }
    const day = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    await client.gpsTrip.create({
      data: {
        id: demoId("trip", v.key, "journey"),
        vehicleId: vid, verizonNumber, day,
        startTs: new Date(t0 - 5 * 3600 * 1000), endTs: new Date(t0 - 4 * 3600 * 1000),
        kind: "journey", distanceMi: Math.round(seeded(vid, 21) * 30 + 5),
        startAddress: "Branch office (demo)", endAddress: "Service route (demo)", sample: true,
      },
    });
    await client.gpsTrip.create({
      data: {
        id: demoId("trip", v.key, "stop"),
        vehicleId: vid, verizonNumber, day,
        startTs: new Date(t0 - 4 * 3600 * 1000), endTs: new Date(t0 - 3.5 * 3600 * 1000),
        kind: "stop", distanceMi: 0, startAddress: "Customer site (demo)", sample: true,
      },
    });
    summary.gpsTrips += 2;
  }

  // Fuel transactions (a couple per demo vehicle; NON-sensitive placeholder data).
  const FUEL: Array<{ key: string; veh: string; days: number; amount: number; gallons: number; cpg: number }> = [
    { key: "f1", veh: "1", days: 6, amount: 82.4, gallons: 22.9, cpg: 3.6 },
    { key: "f2", veh: "1", days: 2, amount: 76.1, gallons: 21.1, cpg: 3.61 },
    { key: "f3", veh: "2", days: 4, amount: 68.9, gallons: 19.1, cpg: 3.6 },
    { key: "f4", veh: "3", days: 3, amount: 91.2, gallons: 25.3, cpg: 3.6 },
  ];
  for (const f of FUEL) {
    const vid = vehicleId[f.veh];
    if (!vid) continue;
    const veh = DEMO_VEHICLES.find((v) => v.key === f.veh)!;
    const id = demoId("fuel", f.key);
    const data = {
      vehicleId: vid,
      date: daysAgo(f.days),
      driverName: veh.assignedTo,
      merchant: "Demo Fuel Stop",
      description: `${DEMO_MARKER} fuel purchase`,
      type: "Purchase",
      category: "Fuel",
      amount: f.amount,
      gallons: f.gallons,
      costPerGallon: f.cpg,
      fuelGrade: "Regular",
      source: "upload",
      plate: veh.plate,
      branch: veh.branch,
      matchMethod: "plate",
      dedupeKey: `demo:fuel:${f.key}`,
    };
    await client.fuelTransaction.upsert({ where: { id }, create: { id, ...data }, update: data });
    summary.fuel++;
  }

  // --- Employees ------------------------------------------------------
  const employeeId: Record<string, string> = {};
  for (const e of DEMO_EMPLOYEES) {
    const id = demoId("emp", e.key);
    const data = {
      name: e.name,
      branch: e.branch,
      role: e.role,
      division: e.division,
      status: "active",
      hireDate: new Date(`${e.hireDate}T00:00:00.000Z`),
      birthMonth: e.birthMonth,
      birthDay: e.birthDay,
      notes: `${DEMO_MARKER} demo profile — no compensation data.`,
    };
    await client.employee.upsert({ where: { id }, create: { id, ...data }, update: data });
    employeeId[e.key] = id;
    summary.employees++;
  }

  // --- Hiring: a job + one candidate mid-pipeline (interviewing) ------
  const jobIdVal = demoId("job", "1");
  const jobData = {
    title: "Demo — Pest Control Technician (Vero Beach)",
    branch: "vero",
    openings: 1,
    description: `${DEMO_MARKER} demo posting — safe to delete.`,
    status: "open",
    applyToken: "demo-apply-token-1",
    hiringManagerName: "Demo — Morgan Lee",
    createdByName: "Demo seed",
  };
  await client.job.upsert({ where: { id: jobIdVal }, create: { id: jobIdVal, ...jobData }, update: jobData });
  summary.job++;

  const candIdVal = demoId("cand", "1");
  const candData = {
    jobId: jobIdVal,
    name: "Demo — Jamie Fox",
    firstName: "Jamie",
    lastName: "Fox",
    email: "demo.jamie@example.com",
    phone: "(772) 555-0190",
    source: "Indeed (demo)",
    stage: "interviewing",
    notes: `${DEMO_MARKER} candidate mid-pipeline; interview scheduled.`,
    interviewAt: daysFromNow(2),
    createdByName: "Demo seed",
  };
  await client.candidate.upsert({ where: { id: candIdVal }, create: { id: candIdVal, ...candData }, update: candData });
  summary.candidates++;

  // Interviewer = the demo Stuart manager profile's implied supervisor (name only;
  // no login linkage needed for the demo).
  const intIdVal = demoId("int", "1");
  const intData = {
    candidateId: candIdVal,
    interviewerName: "Demo — Morgan Lee",
    scheduledAt: daysFromNow(2),
    durationMins: 45,
    type: "in_person",
    location: "Vero Beach branch",
    status: "scheduled",
    responses: "{}",
    assignedByName: "Demo seed",
  };
  await client.interview.upsert({ where: { id: intIdVal }, create: { id: intIdVal, ...intData }, update: intData });
  summary.interviews++;

  // --- PTO request (pending) ------------------------------------------
  if (employeeId["1"]) {
    const id = demoId("pto", "1");
    const data = {
      employeeId: employeeId["1"],
      startDate: daysFromNow(14),
      endDate: daysFromNow(18),
      days: 3,
      type: "vacation",
      note: `${DEMO_MARKER} sample PTO request`,
      status: "pending",
    };
    await client.ptoRequest.upsert({ where: { id }, create: { id, ...data }, update: data });
    summary.pto++;
  }

  // --- Absence (logged call-out; status-only, no medical detail) ------
  if (employeeId["3"]) {
    const id = demoId("abs", "1");
    const data = {
      employeeId: employeeId["3"],
      branch: "orlando",
      startDate: daysAgo(3),
      endDate: daysAgo(3),
      days: 1,
      reason: "employee_illness",
      excused: true,
      noteRequired: false,
      noteStatus: "none",
      loggedByName: "Demo seed",
    };
    await client.absence.upsert({ where: { id }, create: { id, ...data }, update: data });
    summary.absences++;
  }

  // --- Bulletin post --------------------------------------------------
  {
    const id = demoId("bulletin", "1");
    const data = {
      type: "shoutout",
      title: "Demo — Great save on the Vero route!",
      excerpt: "A quick shoutout to the team for a standout week of service.",
      body: "This is a demo bulletin post. In the demo environment you can click around the Company Bulletin freely — nothing here is real company data.\n\nThanks to the Vero crew for a great week on route!",
      honoreeName: "Demo — Taylor Green",
      pinned: true,
      published: true,
      authorName: "Demo Admin",
    };
    await client.bulletinPost.upsert({ where: { id }, create: { id, ...data }, update: data });
    summary.bulletin++;
  }

  return summary;
}

// ---- Reset (destructive; demo-mode-gated) --------------------------------

/**
 * Clear ONLY demo-marked rows, then reseed a fresh demo dataset. GUARD: refuses
 * to run unless demo mode is on (isDemoMode()), so it can never wipe demo rows —
 * let alone be pointed at anything — in a non-demo environment. Never touches
 * real data (clearDemoRows is scoped to demo_ ids + SAMPLE:demo_ GPS rows).
 */
export async function resetDemo(client: PrismaClient = prisma): Promise<DemoSeedSummary> {
  if (!(await isDemoMode(client))) {
    throw new Error("Demo mode is off — refusing to reset demo data.");
  }
  await clearDemoRows(client);
  return seedDemo(client);
}

// Standalone CLI: `tsx prisma/seed-demo.ts` (seed) — does NOT auto-run inside the
// app (guarded by the argv check, matching the other seed-*.ts files).
if (process.argv[1] && process.argv[1].includes("seed-demo")) {
  const cli = new PrismaClient();
  seedDemo(cli)
    .then((s) => console.log("seed-demo:", JSON.stringify(s, null, 2)))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => cli.$disconnect());
}
