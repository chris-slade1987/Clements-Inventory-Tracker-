import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

async function guard() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

function clean(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

export async function POST(req: Request) {
  const user = await guard();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action ?? "";

  try {
    if (action === "create" || action === "update") {
      const name = clean(body?.name);
      const unitOfMeasure = clean(body?.unitOfMeasure);
      if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
      if (!unitOfMeasure) return NextResponse.json({ error: "Unit of measure is required." }, { status: 400 });

      const data = {
        name,
        unitOfMeasure,
        manufacturer: clean(body?.manufacturer),
        epaRegNumber: clean(body?.epaRegNumber),
        category: clean(body?.category),
        barcode: clean(body?.barcode),
        distributorSku: clean(body?.distributorSku),
      };

      if (action === "create") {
        const p = await prisma.product.create({ data });
        return NextResponse.json({ ok: true, id: p.id });
      } else {
        const id = String(body?.id ?? "");
        if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        await prisma.product.update({ where: { id }, data });
        return NextResponse.json({ ok: true });
      }
    }

    if (action === "setActive") {
      const id = String(body?.id ?? "");
      const active = body?.active === true;
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.product.update({ where: { id }, data: { active } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    const msg = (e as { code?: string }).code === "P2002"
      ? "That barcode is already used by another product."
      : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
