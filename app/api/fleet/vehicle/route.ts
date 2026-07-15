import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const flt = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = body?.action ?? "";

  try {
    if (action === "create" || action === "update") {
      const name = str(body?.name);
      if (!name) return NextResponse.json({ error: "Vehicle name is required." }, { status: 400 });
      const data = {
        name,
        unitNumber: str(body?.unitNumber),
        year: int(body?.year),
        make: str(body?.make),
        model: str(body?.model),
        vin: str(body?.vin),
        plate: str(body?.plate),
        branch: str(body?.branch),
        assignedTo: str(body?.assignedTo),
        currentMileage: int(body?.currentMileage),
        mileageAsOf: body?.currentMileage != null && String(body.currentMileage).trim() !== "" ? new Date() : undefined,
        purchasePrice: flt(body?.purchasePrice),
        loanBank: str(body?.loanBank),
        loanNumber: str(body?.loanNumber),
        monthlyPayment: flt(body?.monthlyPayment),
        loanBalance: flt(body?.loanBalance),
        payoffDate: date(body?.payoffDate),
        status: str(body?.status) ?? "active",
      };
      if (action === "create") {
        const v = await prisma.vehicle.create({ data });
        return NextResponse.json({ ok: true, id: v.id });
      }
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.vehicle.update({ where: { id }, data });
      return NextResponse.json({ ok: true });
    }

    // Take a vehicle out of service (sold / retired / etc.). All data is kept;
    // it just moves to the sold & retired list.
    if (action === "dispose" || action === "retire") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.vehicle.update({
        where: { id },
        data: {
          status: "inactive",
          disposition: str(body?.disposition) ?? "retired",
          dispositionDate: date(body?.dispositionDate) ?? new Date(),
          salePrice: flt(body?.salePrice),
          dispositionNotes: str(body?.dispositionNotes),
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "reactivate") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.vehicle.update({
        where: { id },
        data: { status: "active", disposition: null, dispositionDate: null, salePrice: null, dispositionNotes: null },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.vehicle.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    const msg = (e as { code?: string }).code === "P2002" ? "That VIN is already on another vehicle." : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
