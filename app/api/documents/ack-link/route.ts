import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canViewAllPto } from "@/lib/pto";
import { isHrDirector } from "@/lib/personnel";
import { generateAckToken, HANDBOOK_SLUG } from "@/lib/policy-docs";

export const runtime = "nodejs";
export const maxDuration = 20;

// HR/admin only: generate a login-free, per-employee handbook acknowledgment
// link. Returns the absolute URL the manager can copy and send to the employee.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(canViewAllPto(user) || isHrDirector(user))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
  if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });

  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true } });
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  try {
    const { token } = await generateAckToken(HANDBOOK_SLUG, employee.id, employee.name);
    const url = new URL(`/handbook-ack/${token}`, req.url).toString();
    return NextResponse.json({ ok: true, url, token });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
