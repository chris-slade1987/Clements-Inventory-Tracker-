import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { fail, HttpError } from "@/lib/http";

export const maxDuration = 20;

const ALLOWED_KEYS = new Set(["price_increase_threshold_pct", "inventory_escalation_emails"]);

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Settings are company-wide configuration — admins only.
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => null);
    const key: string = body?.key ?? "";
    let value: string = String(body?.value ?? "");
    if (!ALLOWED_KEYS.has(key)) throw new HttpError("Unknown setting.");

    if (key === "price_increase_threshold_pct") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) throw new HttpError("Enter a positive number.");
    }
    if (key === "inventory_escalation_emails") {
      // Comma-separated emails; empty = fall back to the built-in default list.
      const emails = value.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      const bad = emails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
      if (bad) throw new HttpError(`"${bad}" is not a valid email address.`);
      value = emails.join(",");
    }

    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
