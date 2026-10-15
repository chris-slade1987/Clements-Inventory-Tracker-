import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";
import { sendEmail } from "@/lib/email";

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

  // Branch/role transfers (promote/transfer) are a SUPER-ADMIN power only;
  // everyone else keeps those fields as-is.
  const superAdmin = isSuperAdmin(user);

  try {
    const existing = await prisma.employee.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

    const newEmail = str(body?.email); // work email
    const emailChanged = (existing.email ?? "").trim().toLowerCase() !== (newEmail ?? "").trim().toLowerCase();
    const newBranch = superAdmin ? str(body?.branch) : existing.branch;
    const branchChanged = superAdmin && (existing.branch ?? null) !== (newBranch ?? null);

    await prisma.employee.update({
      where: { id },
      data: {
        email: newEmail,
        phone: str(body?.phone), // work phone
        personalPhone: str(body?.personalPhone),
        personalEmail: str(body?.personalEmail),
        nickname: str(body?.nickname),
        title: str(body?.title),
        division: str(body?.division),
        birthMonth: intIn(body?.birthMonth, 1, 12),
        birthDay: intIn(body?.birthDay, 1, 31),
        birthYear: intIn(body?.birthYear, 1940, new Date().getFullYear()), // HR-only
        status: str(body?.status) ?? "active",
        hireDate: date(body?.hireDate),
        // Branch/role transfer — super admins only (promote / transfer).
        ...(superAdmin ? { branch: str(body?.branch), role: str(body?.role) } : {}),
      },
    });

    // Keep the linked login (if any) in lockstep with the canonical profile.
    const login = existing.user;
    if (login) {
      const userData: { email?: string; branch?: string | null } = {};
      // Work email ↔ sign-in email. Only when a non-empty new address is set —
      // User.email is required + unique, so we never null it out.
      if (emailChanged && newEmail) userData.email = newEmail.toLowerCase();
      // Branch transfer: User.branch drives branch-locking, Employee.branch drives
      // roster scoping — keep them aligned so a transfer takes effect everywhere.
      if (branchChanged) userData.branch = newBranch;
      if (Object.keys(userData).length) {
        await prisma.user.update({ where: { id: login.id }, data: userData });
      }
      // Notify the new address that their sign-in email changed. sendEmail no-ops
      // cleanly without a provider, so this is safe pre-launch.
      if (emailChanged && newEmail) {
        await sendEmail({
          to: newEmail,
          subject: "Your CanopyOS sign-in email was updated",
          kind: "login_email_changed",
          relatedType: "user",
          relatedId: login.id,
          text: `Hi ${existing.name},\n\nYour CanopyOS sign-in email has been updated. Your sign-in email is now ${newEmail}. Please use this address the next time you sign in.\n\n— CanopyOS`,
          html: `<p>Hi ${existing.name},</p><p>Your CanopyOS sign-in email has been updated. Your sign-in email is now <strong>${newEmail}</strong>. Please use this address the next time you sign in.</p><p>— CanopyOS</p>`,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
