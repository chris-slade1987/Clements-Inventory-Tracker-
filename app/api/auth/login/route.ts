import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword, PASSWORD_POLICY_ENFORCED } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { appUrl, BRAND } from "@/lib/app-url";

export const maxDuration = 20;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    // Same message whether the email is unknown or the password is wrong.
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Stamp the first-login time once — this starts the 72h clock after which a
    // user still on the shared default password is forced to set their own. On
    // that first login, if they're still on the shared default, email them the
    // 72-hour notice (fire-and-forget; no-ops until Resend is configured).
    if (!user.firstLoginAt) {
      await prisma.user.update({ where: { id: user.id }, data: { firstLoginAt: new Date() } });
      if (PASSWORD_POLICY_ENFORCED && user.mustChangePassword) {
        const origin = appUrl() || new URL(req.url).origin;
        const link = `${origin}/account`;
        void sendEmail({
          to: user.email,
          subject: `Action needed: set your ${BRAND} password within 72 hours`,
          kind: "password_72h",
          relatedType: "user",
          relatedId: user.id,
          text:
            `Welcome to ${BRAND}.\n\nYou're signed in with the shared starter password. ` +
            `For security, please set your own password within 72 hours.\n\nSet it here: ${link}\n`,
          html:
            `<p>Welcome to <strong>${BRAND}</strong>.</p>` +
            `<p>You're signed in with the shared starter password. For security, please set your own password within <strong>72 hours</strong>.</p>` +
            `<p><a href="${link}">Set your password</a> (or in the app: footer → <em>Change password</em>).</p>`,
        }).catch(() => {});
      }
    }

    await createSession(user.id);
    // Board observers → the executive views; employees → their work home; branch
    // managers → their branch; admins → dashboard.
    const redirect =
      user.boardObserver && user.role !== "admin"
        ? "/management/board"
        : user.role === "employee" ? "/me" : user.role !== "admin" && user.branch ? "/my-branch" : "/dashboard";
    return NextResponse.json({ ok: true, redirect });
  } catch (e) {
    // Log the underlying cause server-side (DB unreachable / not migrated) for
    // diagnosis, but never leak it to an unauthenticated caller.
    return fail(e, 500);
  }
}
