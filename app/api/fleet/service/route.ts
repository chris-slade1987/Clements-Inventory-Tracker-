import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const flt = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = body?.action ?? "create";

  try {
    if (action === "delete") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.vehicleService.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    // Batch create — one document (invoice or monthly statement) whose charges
    // may span several vehicles. Each item carries its own vehicle assignment.
    if (action === "createBatch") {
      const items = Array.isArray(body?.items) ? body.items : [];
      const vendor = str(body?.vendor);
      const invoiceRef = str(body?.invoiceRef);
      const rows = items
        .map((it: Record<string, unknown>) => ({
          vehicleId: str(it?.vehicleId),
          date: date(it?.date) ?? new Date(),
          type: str(it?.type) ?? "other",
          description: str(it?.description),
          cost: flt(it?.cost),
          mileage: int(it?.mileage),
          vendor: str(it?.vendor) ?? vendor,
          invoiceRef: str(it?.invoiceRef) ?? invoiceRef,
          nextDueMileage: int(it?.nextDueMileage),
          nextDueDate: date(it?.nextDueDate),
        }))
        .filter((r: { vehicleId: string | null }) => r.vehicleId);
      if (rows.length === 0)
        return NextResponse.json({ error: "Assign at least one charge to a vehicle." }, { status: 400 });

      let created = 0;
      const mileageByVehicle = new Map<string, { mileage: number; when: Date }>();
      for (const r of rows) {
        await prisma.vehicleService.create({ data: { ...r, vehicleId: r.vehicleId! } });
        created++;
        if (r.mileage != null) {
          const prev = mileageByVehicle.get(r.vehicleId!);
          if (!prev || r.mileage > prev.mileage) mileageByVehicle.set(r.vehicleId!, { mileage: r.mileage, when: r.date });
        }
      }
      // Sync each affected vehicle's odometer if a higher reading came through.
      for (const [vehicleId, { mileage, when }] of mileageByVehicle) {
        const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { currentMileage: true } });
        if (v && (v.currentMileage == null || mileage > v.currentMileage))
          await prisma.vehicle.update({ where: { id: vehicleId }, data: { currentMileage: mileage, mileageAsOf: when } });
      }
      return NextResponse.json({ ok: true, created });
    }

    const vehicleId = str(body?.vehicleId);
    if (!vehicleId) return NextResponse.json({ error: "Missing vehicle." }, { status: 400 });
    const when = date(body?.date) ?? new Date();
    const mileage = int(body?.mileage);
    const service = await prisma.vehicleService.create({
      data: {
        vehicleId,
        date: when,
        type: str(body?.type) ?? "other",
        description: str(body?.description),
        cost: flt(body?.cost),
        mileage,
        vendor: str(body?.vendor),
        invoiceRef: str(body?.invoiceRef),
        nextDueMileage: int(body?.nextDueMileage),
        nextDueDate: date(body?.nextDueDate),
      },
    });
    // Keep the vehicle's current mileage in sync if this service reports a higher reading.
    if (mileage != null) {
      const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { currentMileage: true } });
      if (v && (v.currentMileage == null || mileage > v.currentMileage)) {
        await prisma.vehicle.update({ where: { id: vehicleId }, data: { currentMileage: mileage, mileageAsOf: when } });
      }
    }
    return NextResponse.json({ ok: true, id: service.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
