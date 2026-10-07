import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, hashPassword } from "@/lib/auth";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

// Admin-only: force an account back to a working state from the login audit —
// set it Active and reset its password to the shared default clements123. Covers
// the two things that block a sign-in (inactive account, wrong password). Does
// not change the email (if the email is wrong, that's shown in the audit and
// corrected in Users & Access).
export async function POST(req: Request) {
  try {
    const actor = await requireUser();
    if (actor.role !== "admin") throw new HttpError("Admins only.", 403);

    const body = await req.json().catch(() => null);
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!userId) throw new HttpError("Missing userId.");

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!target) throw new HttpError("Account not found.", 404);

    await prisma.user.update({
      where: { id: userId },
      data: { active: true, passwordHash: hashPassword("clements123"), mustChangePassword: true },
    });
    return NextResponse.json({ ok: true, email: target.email });
  } catch (e) {
    return fail(e);
  }
}
