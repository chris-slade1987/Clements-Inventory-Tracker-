import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { ensureSelfEmployeeLink } from "@/lib/self-link";

export const runtime = "nodejs";
export const maxDuration = 20;

const s = (v: unknown) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};

// Self-service contact + emergency-contact edit. An employee updates ONLY their
// OWN record, and ONLY the contact fields they own (personal phone/email +
// emergency contact). The employee is always resolved from the session (never
// trusted from the client), so one login can never edit another's record, and
// work email / branch / role / pay are untouched. Keeps field-safety info current
// without an HR phone loop.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const employeeId = user.employeeId ?? (await ensureSelfEmployeeLink(user));
  if (!employeeId) return NextResponse.json({ error: "Your login isn't linked to an employee profile yet. Ask HR to link it." }, { status: 400 });

  const body = await req.json().catch(() => null);

  try {
    await prisma.employee.update({
      where: { id: employeeId },
      data: {
        personalPhone: s(body?.personalPhone),
        personalEmail: s(body?.personalEmail)?.toLowerCase() ?? null,
        emergencyName: s(body?.emergencyName),
        emergencyRelationship: s(body?.emergencyRelationship),
        emergencyPhone: s(body?.emergencyPhone),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
