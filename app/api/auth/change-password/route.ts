import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, hashPassword, verifyPassword } from "@/lib/auth";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

// Self-serve password change for the signed-in user. They must confirm their
// current password; the new one is validated and re-hashed. No one else's
// account can be touched here (admins use the employee-profile reset instead).
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    if (newPassword.length < 8) throw new HttpError("New password must be at least 8 characters.");
    if (newPassword === currentPassword) throw new HttpError("New password must be different from your current one.");

    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    if (!row) throw new HttpError("Account not found.", 404);
    if (!verifyPassword(currentPassword, row.passwordHash)) throw new HttpError("Your current password is incorrect.");

    // Setting their own password clears the forced-change requirement.
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword), mustChangePassword: false },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
