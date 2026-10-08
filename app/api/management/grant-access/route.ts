import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, canEditAccessLevels } from "@/lib/auth";
import { fail } from "@/lib/http";
import { grantLogin } from "@/lib/provision";

export const runtime = "nodejs";
export const maxDuration = 20;

// Give an employee who has NO login a usable sign-in account at the chosen access
// level (runtime, so it works even when deploy-time seeds don't). Only full/super
// admins may grant access — same gate as changing an access level. The login is
// created at the employee's profile email with the shared default password
// `clements123` and linked to their profile, so it appears on the org chart.
export async function POST(req: Request) {
  try {
    const actor = await getSessionUser();
    if (!actor || !canEditAccessLevels(actor))
      return NextResponse.json({ error: "Only a full admin can grant access." }, { status: 403 });

    const body = await req.json().catch(() => null);
    const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
    const accessLevel = typeof body?.accessLevel === "string" ? body.accessLevel : "";
    if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });

    const res = await grantLogin(prisma, employeeId, accessLevel);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return fail(e);
  }
}
