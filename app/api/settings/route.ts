import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const ALLOWED_KEYS = new Set(["price_increase_threshold_pct"]);

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const key: string = body?.key ?? "";
  const value: string = String(body?.value ?? "");
  if (!ALLOWED_KEYS.has(key)) {
    return NextResponse.json({ error: "Unknown setting." }, { status: 400 });
  }
  if (key === "price_increase_threshold_pct") {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "Enter a positive number." }, { status: 400 });
    }
  }
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  return NextResponse.json({ ok: true });
}
