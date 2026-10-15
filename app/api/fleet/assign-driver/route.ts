import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;

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

  // Branch-locked managers may only touch vehicles at their own branch.
  if (branchLocked(user)) {
    const veh = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branch: true } });
    if (veh?.branch && veh.branch !== user.branch)
      return NextResponse.json({ error: "That vehicle isn't at your branch." }, { status: 403 });
  }

  try {
    if (!employeeId) {
      await prisma.vehicle.update({ where: { id: vehicleId }, data: { assignedEmployeeId: null, assignedTo: null } });
      return NextResponse.json({ ok: true, driver: null });
    }
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true, branch: true } });
    if (!emp) return NextResponse.json({ error: "That employee no longer exists." }, { status: 400 });
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branch: true } });
    // Branch-locked managers may only reassign within their own branch: the
    // vehicle must already be theirs, and they cannot pull it to another branch.
    if (branchLocked(user)) {
      if (vehicle?.branch && vehicle.branch !== user.branch)
        return NextResponse.json({ error: "That vehicle isn't at your branch." }, { status: 403 });
      if (emp.branch && emp.branch !== user.branch)
        return NextResponse.json({ error: "You can only assign drivers within your branch." }, { status: 403 });
    }
    // The vehicle follows its driver: when the new driver has a home branch and the
    // vehicle isn't already there, move it in the same update so the fleet board's
    // by-branch view reflects the reassignment immediately (no separate manual step).
    const movedToBranch = emp.branch && emp.branch !== vehicle?.branch ? emp.branch : null;
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { assignedEmployeeId: emp.id, assignedTo: emp.name, ...(movedToBranch ? { branch: movedToBranch } : {}) },
    });
    return NextResponse.json({ ok: true, driver: emp.name, movedToBranch });
  } catch (e) {
    return fail(e);
  }
}
