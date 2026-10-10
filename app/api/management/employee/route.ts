import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";

export const runtime = "nodejs";
export const maxDuration = 20;

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
// Parse an integer within [min,max]; anything else (blank, non-numeric, out of
// range) -> null, so clearing a birthday field just unsets it.
const intIn = (v: unknown, min: number, max: number) => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "").trim(), 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
// Parse a date-only "YYYY-MM-DD" value as UTC midnight (timezone-stable); empty -> null.
const date = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00.000Z" : s;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

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
        phone: str(body?.phone), // work phone
        personalPhone: str(body?.personalPhone),
        personalEmail: str(body?.personalEmail),
        title: str(body?.title),
        division: str(body?.division),
        birthMonth: intIn(body?.birthMonth, 1, 12),
        birthDay: intIn(body?.birthDay, 1, 31),
        status: str(body?.status) ?? "active",
        hireDate: date(body?.hireDate),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
