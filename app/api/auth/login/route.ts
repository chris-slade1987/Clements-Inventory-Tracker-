import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, verifyPassword } from "@/lib/auth";

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
    // Employees → their work home; branch managers → their branch; admins → dashboard.
    const redirect =
      user.role === "employee" ? "/me" : user.role !== "admin" && user.branch ? "/my-branch" : "/dashboard";
    return NextResponse.json({ ok: true, redirect });
  } catch (e) {
    // Surface the underlying cause (e.g. database not reachable / not migrated)
    // instead of a generic failure, so setup issues are diagnosable.
    return NextResponse.json(
      { error: `Sign-in error: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
