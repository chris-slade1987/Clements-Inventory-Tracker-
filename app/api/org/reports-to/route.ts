import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageAccessRights } from "@/lib/access";
import { setReportsTo } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 20;

// Reassign an employee's supervisor from the visual Org Chart's edit mode.
//   POST /api/org/reports-to { employeeId, reportsToId|null } → { ok, employee, manager }
//
// SUPER ADMINS ONLY (Chris / Julie / April — `canManageAccessRights`). Updates the
// real Employee.reportsToId (so the person's profile + team reflect the move) with
// the same cycle guard used by the HR console (`setReportsTo`): no self-report, no
// reporting to someone already on your own team.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canManageAccessRights(user))
    return NextResponse.json({ error: "Only super admins can move people on the org chart." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
  const reportsToId = typeof body?.reportsToId === "string" && body.reportsToId ? body.reportsToId : null;
  if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });
  if (reportsToId === employeeId)
    return NextResponse.json({ error: "An employee can't report to themselves." }, { status: 400 });

  const res = await setReportsTo(employeeId, reportsToId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  // Return the fresh names so the client can confirm the move without a full reload.
  const [employee, manager] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true, reportsToId: true } }),
    reportsToId ? prisma.employee.findUnique({ where: { id: reportsToId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  return NextResponse.json({ ok: true, employee, manager });
}
