import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

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
