import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { readXlsxGrids, gridRows, excelDate } from "@/lib/xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: string | undefined) => { const s = (v ?? "").trim(); return s === "" ? null : s; };
const int = (v: string | undefined) => { const n = parseFloat((v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? Math.trunc(n) : null; };
const flt = (v: string | undefined) => { const n = parseFloat((v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };

function matchBranch(v: string | null): string | null {
  const s = (v ?? "").toLowerCase();
  if (s.includes("vero")) return "vero";
  if (s.includes("stuart")) return "stuart";
  if (s.includes("orlando")) return "orlando";
  if (s.includes("naples")) return "naples";
  return null;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "Upload the fleet sheet (.xlsx)." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const name = (file as File).name ?? "";
  const isXlsx = name.toLowerCase().endsWith(".xlsx") || (file.type ?? "").includes("spreadsheet");
  if (!isXlsx)
    return NextResponse.json({ error: "Please upload the Excel (.xlsx) fleet sheet." }, { status: 400 });

  const grids = readXlsxGrids(new Uint8Array(bytes));
  if (grids.length === 0)
    return NextResponse.json({ error: "No worksheets found." }, { status: 400 });

  // --- Tab 1: Vehicle Fleet (registry) --------------------------------------
  // Columns (0-indexed): 0 branch, 1 unit#, 2 tech, 3 card, 4 year, 5 make,
  // 6 model, 7 vin, 8 plate, 9 DL#, 11 reg renewal, 14 GPS, 15 bank, 16 loan#,
  // 17 monthly payment, 18 payoff date.
  const fleet = grids[0].grid;
  const existing = await prisma.vehicle.findMany();
  const byVin = new Map(existing.filter((v) => v.vin).map((v) => [v.vin!.toUpperCase(), v]));
  const byUnit = new Map(existing.filter((v) => v.unitNumber).map((v) => [v.unitNumber!, v]));

  let created = 0, updated = 0;
  const skipped: string[] = [];
  let lastBranch: string | null = null;
  const unitToId = new Map<string, string>();

  for (const { r, cells } of gridRows(fleet)) {
    if (r === 1) continue; // header
    const g = (c: number) => cells.get(c) ?? "";
    const unitRaw = int(g(1));
    const vin = str(g(7))?.toUpperCase() ?? null;
    if (unitRaw == null && !vin) continue; // blank row
    const branch: string | null = matchBranch(str(g(0))) ?? lastBranch;
    if (branch) lastBranch = branch;
    const unitNumber = unitRaw != null ? String(unitRaw) : null;
    const year = int(g(4));
    const make = str(g(5));
    const model = str(g(6));
    const composed = [year, make, model].filter(Boolean).join(" ").trim();
    // Only build a "year make model" name when there's an actual make/model;
    // trailers/spares with a bare year fall back to their assigned label.
    const name = make || model ? composed : str(g(2)) || `Vehicle ${unitNumber ?? vin}`;
    const data = {
      unitNumber,
      name,
      year,
      make,
      model,
      vin,
      plate: str(g(8)),
      branch,
      assignedTo: str(g(2)),
      driverCard: str(g(3)),
      driverLicense: str(g(9)),
      registrationRenewal: excelDate(g(11)),
      gps: str(g(14)),
      loanBank: str(g(15)),
      loanNumber: str(g(16)),
      monthlyPayment: flt(g(17)),
      payoffDate: excelDate(g(18)),
    };
    try {
      const found = (vin && byVin.get(vin)) || (unitNumber && byUnit.get(unitNumber)) || null;
      if (found) {
        await prisma.vehicle.update({ where: { id: found.id }, data });
        updated++;
        if (unitNumber) unitToId.set(unitNumber, found.id);
      } else {
        const v = await prisma.vehicle.create({ data });
        created++;
        if (unitNumber) unitToId.set(unitNumber, v.id);
      }
    } catch (e) {
      skipped.push(`Unit ${unitNumber ?? vin}: ${(e as Error).message}`);
    }
  }

  // --- Tab 2: Vehicle Status (mileage + replacement notes) ------------------
  // Columns: 0 truck no (#26), 4 mileage, 5 status/notes.
  let mileageUpdated = 0;
  if (grids[1]) {
    const now = new Date();
    // Re-fetch so newly-created vehicles are matchable by unit number.
    const all = await prisma.vehicle.findMany({ where: { unitNumber: { not: null } } });
    const byUnit2 = new Map(all.map((v) => [v.unitNumber!, v]));
    for (const { r, cells } of gridRows(grids[1].grid)) {
      if (r === 1) continue;
      const truck = (cells.get(0) ?? "").replace(/[^0-9]/g, "");
      if (!truck) continue;
      const v = byUnit2.get(truck);
      if (!v) { skipped.push(`Status: truck #${truck} not found in registry`); continue; }
      const mileage = int(cells.get(4));
      const notes = str(cells.get(5));
      await prisma.vehicle.update({
        where: { id: v.id },
        data: { currentMileage: mileage ?? undefined, mileageAsOf: mileage != null ? now : undefined, statusNotes: notes ?? undefined },
      });
      mileageUpdated++;
    }
  }

  return NextResponse.json({ ok: true, created, updated, mileageUpdated, skipped });
}
