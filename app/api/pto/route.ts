import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import {
  createPtoRequest,
  decidePtoRequest,
  cancelPtoRequest,
  branchSupervisorEmails,
  ptoTypeLabel,
  isManagerOrAbove,
  employeeIsManagerOrAbove,
} from "@/lib/pto";
import { sendEmail } from "@/lib/email";
import { hrDirectorEmail } from "@/lib/personnel";
import { branchLabel } from "@/lib/management";

export const runtime = "nodejs";

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const dateOf = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d; };

const APP = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** May the actor decide (approve/deny) or set allowance for someone on `branch`? */
function canManageBranch(user: SessionUser, branch: string | null): boolean {
  if (user.role === "admin" || user.hrAccess) return true;
  if (user.role === "manager" && user.branch && user.branch === branch) return true;
  return false;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = s(body?.action);

  try {
    // -- Employee submits a request for THEIR OWN profile -------------------
    if (action === "request") {
      if (!user.employeeId) return NextResponse.json({ error: "Your login isn't linked to an employee profile." }, { status: 400 });
      const start = dateOf(body?.start);
      const end = dateOf(body?.end);
      if (!start || !end) return NextResponse.json({ error: "Choose a start and end date." }, { status: 400 });

      const request = await createPtoRequest({
        employeeId: user.employeeId, // derived from the session — never trust the client
        start,
        end,
        type: s(body?.type) ?? "vacation",
        note: s(body?.note),
      });

      // Route the request. Branch manager and above (manager/admin/super_admin
      // rights) go straight to the Director of HR for approval; everyone else
      // goes to their branch supervisor (falling back to HR when a branch has no
      // manager). The request also surfaces in the right reminders automatically.
      const managerPlus = isManagerOrAbove(user);
      const to = managerPlus ? [hrDirectorEmail()] : await branchSupervisorEmails(request.employee.branch);
      const link = `${APP()}/${managerPlus ? "management/people/pto" : "my-branch/team"}`;
      const range = request.days > 1 ? `${fmt(request.startDate)} – ${fmt(request.endDate)}` : fmt(request.startDate);
      const hrRouteNote = managerPlus
        ? `<p style="color:#5b7a70;font-size:13px">This is a manager-level PTO request and has been routed to the Director of HR for approval.</p>`
        : "";
      await sendEmail({
        to,
        subject: `PTO request${managerPlus ? " (HR approval)" : ""} — ${request.employee.name} (${request.days} day${request.days === 1 ? "" : "s"})`,
        html: `<p><strong>${request.employee.name}</strong>${request.employee.branch ? ` (${branchLabel(request.employee.branch)})` : ""} requested paid time off.</p>
<p><strong>${ptoTypeLabel(request.type)}</strong> · ${request.days} day${request.days === 1 ? "" : "s"}<br/>${range}${request.note ? `<br/>Note: ${request.note}` : ""}</p>
${hrRouteNote}<p>Review it${link ? `: <a href="${link}">${link}</a>` : "."}.${managerPlus ? "" : " It also appears in your reminders on your branch dashboard."}</p>`,
        text: `${request.employee.name} requested ${request.days} PTO day(s) (${ptoTypeLabel(request.type)}): ${range}.${managerPlus ? " Routed to the Director of HR for approval." : " Review it on your team page."}`,
        kind: "pto_request",
        relatedType: "pto_request",
        relatedId: request.id,
      });

      return NextResponse.json({ ok: true, id: request.id });
    }

    // -- Supervisor / HR / admin approves or denies ------------------------
    if (action === "decide") {
      const id = s(body?.id);
      const approve = body?.approve === true || body?.approve === "true";
      if (!id) return NextResponse.json({ error: "Missing request." }, { status: 400 });
      const existing = await prisma.ptoRequest.findUnique({ where: { id }, include: { employee: { select: { branch: true } } } });
      if (!existing) return NextResponse.json({ error: "Request not found." }, { status: 404 });
      if (existing.status !== "pending") return NextResponse.json({ error: "This request has already been decided." }, { status: 409 });
      // Manager-and-above PTO is the Director of HR's (or an admin's) call — a
      // branch supervisor can't approve a peer/their own manager-level request.
      const requesterMgrPlus = await employeeIsManagerOrAbove(existing.employeeId);
      if (requesterMgrPlus) {
        if (!(user.role === "admin" || user.hrAccess))
          return NextResponse.json({ error: "Manager-level PTO is routed to the Director of HR for approval." }, { status: 403 });
      } else if (!canManageBranch(user, existing.employee.branch)) {
        return NextResponse.json({ error: "You can only review requests for your own branch." }, { status: 403 });
      }

      const request = await decidePtoRequest(id, approve, user, s(body?.note));

      // Notify the employee of the decision.
      const range = request.days > 1 ? `${fmt(request.startDate)} – ${fmt(request.endDate)}` : fmt(request.startDate);
      const decision = approve ? "approved" : "denied";
      await sendEmail({
        to: request.employee.email,
        subject: `Your PTO request was ${decision}`,
        html: `<p>Your paid-time-off request has been <strong>${decision}</strong> by ${user.name}.</p>
<p><strong>${ptoTypeLabel(request.type)}</strong> · ${request.days} day${request.days === 1 ? "" : "s"}<br/>${range}${request.decisionNote ? `<br/>Note: ${request.decisionNote}` : ""}</p>`,
        text: `Your PTO request (${range}) was ${decision} by ${user.name}.`,
        kind: "pto_decision",
        relatedType: "pto_request",
        relatedId: request.id,
      });

      return NextResponse.json({ ok: true });
    }

    // -- Employee cancels their own pending request ------------------------
    if (action === "cancel") {
      if (!user.employeeId) return NextResponse.json({ error: "No employee profile." }, { status: 400 });
      const id = s(body?.id);
      if (!id) return NextResponse.json({ error: "Missing request." }, { status: 400 });
      await cancelPtoRequest(id, user.employeeId);
      return NextResponse.json({ ok: true });
    }

    // -- HR / admin / branch manager sets an employee's annual allotment ---
    if (action === "setAllowance") {
      const employeeId = s(body?.employeeId);
      if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });
      const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { branch: true } });
      if (!emp) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
      if (!canManageBranch(user, emp.branch))
        return NextResponse.json({ error: "You can only set allowances for your own branch." }, { status: 403 });
      const raw = body?.allowanceDays;
      const days = raw === null || raw === "" || raw === undefined ? null : Math.max(0, parseInt(String(raw), 10));
      if (days !== null && !Number.isFinite(days)) return NextResponse.json({ error: "Enter a whole number of days." }, { status: 400 });
      await prisma.employee.update({ where: { id: employeeId }, data: { ptoAllowanceDays: days } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
