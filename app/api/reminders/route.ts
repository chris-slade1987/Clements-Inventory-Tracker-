import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";

export const runtime = "nodejs";

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const int = (v: unknown, d: number) => { const n = parseInt(String(v ?? ""), 10); return Number.isFinite(n) && n >= 0 ? n : d; };
const dateOf = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d; };
const SEV = new Set(["info", "warning", "critical"]);
const NOTIFY = new Set(["hr", "creator", "both"]);

// Manual reminders tagged to an employee or vehicle. Managers & HR can create;
// managers are scoped to their own branch's employees/vehicles.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager" && !isHrDirector(user)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = s(body?.action) ?? "create";

  try {
    if (action === "create") {
      const title = s(body?.title);
      const dueDate = dateOf(body?.dueDate);
      if (!title) return NextResponse.json({ error: "Give the reminder a title." }, { status: 400 });
      if (!dueDate) return NextResponse.json({ error: "Choose when it's due." }, { status: 400 });

      let employeeId = s(body?.employeeId);
      let vehicleId = s(body?.vehicleId);
      let branch = s(body?.branch);

      // Resolve branch from the tagged entity and enforce branch scoping for managers.
      if (employeeId) {
        const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { branch: true } });
        if (!e) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
        branch = e.branch;
        vehicleId = null;
      } else if (vehicleId) {
        const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branch: true } });
        if (!v) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
        branch = v.branch;
        employeeId = null;
      }
      if (branchLocked(user) && branch && branch !== user.branch)
        return NextResponse.json({ error: "That's not on your branch." }, { status: 403 });
      if (branchLocked(user) && !branch) branch = user.branch;

      const entityType = employeeId ? "employee" : vehicleId ? "vehicle" : "general";
      const severity = SEV.has(String(body?.severity)) ? String(body?.severity) : "info";
      const notify = NOTIFY.has(String(body?.notify)) ? String(body?.notify) : "hr";

      const r = await prisma.reminder.create({
        data: {
          title,
          notes: s(body?.notes),
          dueDate,
          leadDays: int(body?.leadDays, 14),
          severity,
          entityType,
          employeeId,
          vehicleId,
          branch,
          notify,
          createdByUserId: user.id,
          createdByName: user.name,
          createdByEmail: user.email,
        },
      });
      return NextResponse.json({ ok: true, id: r.id });
    }

    const id = s(body?.id);
    if (!id) return NextResponse.json({ error: "Missing reminder." }, { status: 400 });

    if (action === "complete" || action === "dismiss" || action === "reopen") {
      const status = action === "complete" ? "done" : action === "dismiss" ? "dismissed" : "open";
      await prisma.reminder.update({ where: { id }, data: { status } });
      return NextResponse.json({ ok: true });
    }
    if (action === "delete") {
      await prisma.reminder.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
