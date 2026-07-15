import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const date = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d; };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && !isHrDirector(user)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const id = str(body?.id);
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  try {
    await prisma.employee.update({
      where: { id },
      data: {
        email: str(body?.email),
        phone: str(body?.phone),
        title: str(body?.title),
        status: str(body?.status) ?? "active",
        hireDate: date(body?.hireDate),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
