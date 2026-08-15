import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { normalizeRole, normalizeDivision } from "@/lib/constants";

export const maxDuration = 20;

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
      const homeWarehouseId = String(body?.homeWarehouseId ?? "");
      if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
      if (!homeWarehouseId)
        return NextResponse.json({ error: "Home warehouse is required." }, { status: 400 });

      const wh = await prisma.warehouse.findUnique({ where: { id: homeWarehouseId } });
      if (!wh) return NextResponse.json({ error: "Warehouse not found." }, { status: 400 });

      const data = {
        name,
        homeWarehouseId,
        employeeIdCard: clean(body?.employeeIdCard),
        role: normalizeRole(body?.role),
        division: normalizeDivision(body?.division),
      };

      if (action === "create") {
        const t = await prisma.technician.create({ data });
        return NextResponse.json({ ok: true, id: t.id });
      } else {
        const id = String(body?.id ?? "");
        if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        await prisma.technician.update({ where: { id }, data });
        return NextResponse.json({ ok: true });
      }
    }

    if (action === "setActive") {
      const id = String(body?.id ?? "");
      const active = body?.active === true;
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.technician.update({ where: { id }, data: { active } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
