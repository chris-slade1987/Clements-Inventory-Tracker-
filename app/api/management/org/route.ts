import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { setReportsTo } from "@/lib/org";

export const runtime = "nodejs";

// Set (or clear) an employee's reporting line on the org chart. Admin-only for
// now; team-scoped editing arrives with the access-level phase.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
  const reportsToId = typeof body?.reportsToId === "string" && body.reportsToId ? body.reportsToId : null;
  if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });

  const res = await setReportsTo(employeeId, reportsToId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
