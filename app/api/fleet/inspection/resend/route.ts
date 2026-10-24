import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { resendInspectionReport } from "@/lib/inspection-email";

export const runtime = "nodejs";
export const maxDuration = 20;

// Resend a filed inspection's report email to the graded driver AND the person
// clicking (the inspector / viewing manager). Managers + admins only; a
// branch-locked manager can only resend for vehicles at their own branch. The
// recipients are derived server-side — the caller only names the inspection.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const inspectionId = typeof body?.inspectionId === "string" ? body.inspectionId.trim() : "";
  if (!inspectionId) return NextResponse.json({ error: "Missing inspection." }, { status: 400 });

  const insp = await prisma.vehicleInspection.findUnique({
    where: { id: inspectionId },
    select: { id: true, branch: true, employeeId: true },
  });
  if (!insp) return NextResponse.json({ error: "Inspection not found." }, { status: 404 });
  if (branchLocked(user) && insp.branch && insp.branch !== user.branch)
    return NextResponse.json({ error: "That inspection is not at your branch." }, { status: 403 });

  // Graded driver's email + the clicking user's own email ("to me and Rob").
  const emp = insp.employeeId
    ? await prisma.employee.findUnique({ where: { id: insp.employeeId }, select: { email: true } })
    : null;

  const result = await resendInspectionReport({
    inspectionId,
    recipients: [emp?.email, user.email],
    reqUrl: req.url,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Could not resend.", statuses: result.statuses }, { status: 502 });
  }
  return NextResponse.json({ ok: true, statuses: result.statuses });
}
