import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { fail, HttpError } from "@/lib/http";
import { alignLogin, resetAllLogins } from "@/lib/login-fix";

export const runtime = "nodejs";
export const maxDuration = 60;

// Admin-only runtime login repair (runs against the LIVE database, so it works
// even when deploy-time seeds don't). `action:"all"` resets every login to its
// employee-profile email + clements123 + active; otherwise fixes one by userId.
export async function POST(req: Request) {
  try {
    const actor = await requireUser();
    if (actor.role !== "admin") throw new HttpError("Admins only.", 403);

    const body = await req.json().catch(() => null);

    if (body?.action === "all") {
      const r = await resetAllLogins(prisma);
      return NextResponse.json({ ok: true, ...r });
    }

    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!userId) throw new HttpError("Missing userId.");
    const email = await alignLogin(prisma, userId);
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    return fail(e);
  }
}
