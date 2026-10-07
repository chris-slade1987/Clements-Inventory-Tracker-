import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, hashPassword, canResetPasswords } from "@/lib/auth";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

// Admin password reset from an employee profile. Restricted to the CEO/COO
// (admin), the Chief of Staff (senior leadership), and the Director of HR (HR
// access) — Chris, Julie, April. Sets a new password on the employee's linked
// login account. The new password is chosen by the admin and returned so they
// can hand it off; it is never stored in plaintext.
export async function POST(req: Request) {
  try {
    const actor = await requireUser();
    if (!canResetPasswords(actor)) {
      throw new HttpError("Only the CEO, Chief of Staff, or Director of HR may reset a password.", 403);
    }

    const body = await req.json().catch(() => null);
    const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    if (!employeeId) throw new HttpError("Missing employee id.");
    if (newPassword.length < 8) throw new HttpError("Password must be at least 8 characters.");

    const login = await prisma.user.findFirst({ where: { employeeId }, select: { id: true, email: true } });
    if (!login) throw new HttpError("This employee has no login account to reset.", 404);

    await prisma.user.update({ where: { id: login.id }, data: { passwordHash: hashPassword(newPassword) } });
    return NextResponse.json({ ok: true, email: login.email });
  } catch (e) {
    return fail(e);
  }
}
