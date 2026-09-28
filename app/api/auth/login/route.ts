import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";

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
