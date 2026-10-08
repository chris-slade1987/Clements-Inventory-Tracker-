import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { resetAllLogins } from "@/lib/login-fix";

export const runtime = "nodejs";
export const maxDuration = 60;

// ONE-TIME emergency bootstrap (to be removed right after use). Unauthenticated
// but gated by a secret key, because no admin can currently sign in. When hit
// with the correct key it:
//   1. Resets EVERY login to its employee-profile email + clements123 + active
//      (the same runtime repair as the "Reset ALL logins" button).
//   2. Forces the two admin accounts to active + admin + super_admin + clements123
//      so there is a working admin to sign in with.
// Runs against the LIVE database at request time (not a deploy-time seed).
const BOOTSTRAP_KEY = "b7Qx9fK2mYv4Lp8Rt3Nw6Zc1Hs5Dj0Ug";
const ADMIN_EMAILS = ["manager@clementspest.com", "c.slade@clementspestcontrol.com"];

async function run(key: string) {
  if (key !== BOOTSTRAP_KEY) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1) Fix everyone.
  const all = await resetAllLogins(prisma);

  // 2) Guarantee working admins.
  const admins: Record<string, string> = {};
  for (const email of ADMIN_EMAILS) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash: hashPassword("clements123"), active: true, role: "admin", accessLevel: "super_admin", mustChangePassword: false },
      });
      admins[email] = "updated";
    } else {
      await prisma.user.create({
        data: { name: "Admin", email, passwordHash: hashPassword("clements123"), active: true, role: "admin", accessLevel: "super_admin" },
      });
      admins[email] = "created";
    }
  }

  return NextResponse.json({ ok: true, resetAll: all, admins, signInWith: { email: "manager@clementspest.com", password: "clements123" } });
}

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  return run(key);
}
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : new URL(req.url).searchParams.get("key") ?? "";
  return run(key);
}
