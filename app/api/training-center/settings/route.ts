import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { PACING_SETTING_KEY } from "@/lib/training-assign";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // The pacing limit is company-wide configuration — admins only.
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => null);
    const n = Number(body?.modulesPerMonth);
    if (!Number.isInteger(n) || n < 0) throw new HttpError("Enter 0 (off) or a positive whole number.");
    await prisma.setting.upsert({
      where: { key: PACING_SETTING_KEY },
      create: { key: PACING_SETTING_KEY, value: String(n) },
      update: { value: String(n) },
    });
    return NextResponse.json({ ok: true, modulesPerMonth: n });
  } catch (e) {
    return fail(e);
  }
}
