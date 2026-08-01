import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { scoreAudit, type Facility, type YesNo, type Ratings5 } from "@/lib/audit";
import { branchLabel } from "@/lib/management";
import { listEmployees, matchEmployeeByName } from "@/lib/people";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = body?.action ?? "save";

  try {
    // Branch managers may resolve their own branch's follow-ups; everything else is admin-only.
    if (action === "followupDone") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const fu = await prisma.auditFollowUp.findUnique({ where: { id } });
      if (!fu) return NextResponse.json({ error: "Not found." }, { status: 404 });
      if (user.role !== "admin" && !(branchLocked(user) && user.branch === fu.branch))
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const done = body?.done !== false;
      await prisma.auditFollowUp.update({ where: { id }, data: { status: done ? "done" : "open", resolvedAt: done ? new Date() : null } });
      return NextResponse.json({ ok: true });
    }

    if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (action === "delete") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.branchAudit.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    if (action === "precheck") {
      const branch = str(body?.branch);
      const year = int(body?.year);
      const quarter = int(body?.quarter);
      if (!branch || !year || !quarter) return NextResponse.json({ error: "Missing branch/year/quarter." }, { status: 400 });
      const items = JSON.stringify(body?.items ?? {});
      const notes = str(body?.notes);
      await prisma.auditPrecheck.upsert({
        where: { branch_year_quarter: { branch, year, quarter } },
        create: { branch, year, quarter, items, notes },
        update: { items, notes },
      });
      return NextResponse.json({ ok: true });
    }

    // save / submit
    const branch = str(body?.branch);
    if (!branch) return NextResponse.json({ error: "Select a branch." }, { status: 400 });
    const visit = date(body?.visitDate) ?? new Date();
    const year = int(body?.year) ?? visit.getFullYear();
    const quarter = int(body?.quarter) ?? Math.floor(visit.getMonth() / 3) + 1;
    const facility: Facility = (body?.facility ?? {}) as Facility;
    const personnel: YesNo = (body?.personnel ?? {}) as YesNo;
    const ratings: Ratings5 = (body?.ratings ?? {}) as Ratings5;
    const { score, maxScore, scorePct } = scoreAudit(facility, personnel, ratings);
    const submit = action === "submit";

    const data = {
      branch,
      year,
      quarter,
      visitDate: visit,
      auditorName: str(body?.auditorName) ?? user.name,
      status: submit ? "submitted" : "draft",
      facility: JSON.stringify(facility),
      personnel: JSON.stringify(personnel),
      ratings: JSON.stringify(ratings),
      facilityIssues: str(body?.facilityIssues),
      concerns: str(body?.concerns),
      suggestions: str(body?.suggestions),
      nextQuarterPlan: str(body?.nextQuarterPlan),
      score,
      maxScore,
      scorePct,
      submittedAt: submit ? new Date() : null,
    };

    const audit = await prisma.branchAudit.upsert({
      where: { branch_year_quarter: { branch, year, quarter } },
      create: data,
      update: data,
    });

    // Replace ride-alongs, tagging each to an employee where possible.
    const emps = (await listEmployees(branch)).map((e) => ({ id: e.id, name: e.name, role: e.role, division: e.division, branch: e.branch }));
    await prisma.auditRideAlong.deleteMany({ where: { auditId: audit.id } });
    const rideAlongs = Array.isArray(body?.rideAlongs) ? body.rideAlongs : [];
    for (const r of rideAlongs) {
      const technicianName = str(r?.technicianName);
      if (!technicianName && !str(r?.serviceType)) continue;
      await prisma.auditRideAlong.create({
        data: {
          auditId: audit.id,
          employeeId: str(r?.employeeId) ?? (technicianName ? matchEmployeeByName(technicianName, emps) : null),
          technicianName,
          serviceType: str(r?.serviceType),
          customerInteraction: int(r?.customerInteraction),
          serviceExecution: int(r?.serviceExecution),
          equipmentPrep: int(r?.equipmentPrep),
          safety: int(r?.safety),
          customerNotes: str(r?.customerNotes),
          executionNotes: str(r?.executionNotes),
          equipmentNotes: str(r?.equipmentNotes),
          safetyNotes: str(r?.safetyNotes),
          strengths: str(r?.strengths),
          improvement: str(r?.improvement),
          coaching: str(r?.coaching),
        },
      });
    }

    // Replace follow-up action items (deadlines drive manager reminders).
    await prisma.auditFollowUp.deleteMany({ where: { auditId: audit.id } });
    const followUps = Array.isArray(body?.followUps) ? body.followUps : [];
    for (const fu of followUps) {
      const description = str(fu?.description);
      if (!description) continue;
      await prisma.auditFollowUp.create({
        data: { auditId: audit.id, branch, description, dueDate: date(fu?.dueDate), status: "open" },
      });
    }

    // On submit, email the branch manager a copy + the action items.
    let emailStatus: string | null = null;
    if (submit) {
      const mgr = await prisma.user.findFirst({ where: { role: "manager", branch } });
      const savedFollowUps = await prisma.auditFollowUp.findMany({ where: { auditId: audit.id } });
      const fuList = savedFollowUps.map((f) => `• ${f.description}${f.dueDate ? ` (due ${f.dueDate.toLocaleDateString()})` : ""}`).join("\n");
      const label = branchLabel(branch);
      const res = await sendEmail({
        to: mgr?.email,
        subject: `Q${quarter} ${year} Branch Audit — ${label} (${scorePct}%)`,
        kind: "audit_report",
        relatedType: "branch_audit",
        relatedId: audit.id,
        text: `The Q${quarter} ${year} field-operations audit for ${label} has been completed by ${data.auditorName}.\n\nBranch score: ${score}/${maxScore} (${scorePct}%).\n${fuList ? `\nAction items before next visit:\n${fuList}\n` : ""}\nThese action items now appear on your manager dashboard with their deadlines.\n\n— CanopyOS`,
        html: `<p>The <strong>Q${quarter} ${year}</strong> field-operations audit for <strong>${label}</strong> was completed by ${data.auditorName}.</p><p style="font-size:18px"><strong>Branch score: ${score}/${maxScore} (${scorePct}%)</strong></p>${fuList ? `<p><strong>Action items before next visit:</strong></p><ul>${savedFollowUps.map((f) => `<li>${f.description}${f.dueDate ? ` <em>(due ${f.dueDate.toLocaleDateString()})</em>` : ""}</li>`).join("")}</ul>` : ""}<p>These action items now appear on your manager dashboard with their deadlines.</p><p>— CanopyOS</p>`,
      });
      emailStatus = res.status;
    }

    return NextResponse.json({ ok: true, id: audit.id, score, maxScore, scorePct, status: data.status, emailStatus });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
