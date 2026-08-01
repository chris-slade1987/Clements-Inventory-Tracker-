import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

// Assign / swap / remove the technician (driver) on a vehicle. Writes the
// structured FK (assignedEmployeeId) AND keeps the assignedTo name string in
// sync so all existing name-based features (inspections auto-fill, document
// matching, per-tech assigned-vehicle lists) keep working. Admin or manager.
const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const vehicleId = str(body?.vehicleId);
  if (!vehicleId) return NextResponse.json({ error: "Missing vehicleId." }, { status: 400 });
  const employeeId = str(body?.employeeId); // null / absent => remove the driver

  try {
    if (!employeeId) {
      await prisma.vehicle.update({ where: { id: vehicleId }, data: { assignedEmployeeId: null, assignedTo: null } });
      return NextResponse.json({ ok: true, driver: null });
    }
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true } });
    if (!emp) return NextResponse.json({ error: "That employee no longer exists." }, { status: 400 });
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { assignedEmployeeId: emp.id, assignedTo: emp.name } });
    return NextResponse.json({ ok: true, driver: emp.name });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
