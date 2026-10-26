import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { scoreAudit, auditTitle, managerEmployeeForBranch, fieldOpsEmployee, type Facility, type YesNo, type Ratings5 } from "@/lib/audit";
import { newSignToken } from "@/lib/audit-finalize";
import { branchLabel } from "@/lib/management";
import { listEmployees, matchEmployeeByName } from "@/lib/people";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 20;

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };

// Absolute origin for the emailed manager sign link (prefers APP_URL, falls back
// to the live request host so the link is never a broken relative path).
function reqBase(req: Request): string {
  const env = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "";
}

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

    // Reopen a signed/pending audit for correction — clears the manager signature
    // + token so it can be re-signed (the filed profile copies are overwritten on
    // the next finalize). The auditor signature is kept.
    if (action === "reopen") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.branchAudit.update({
        where: { id },
        data: { status: "draft", managerSignToken: null, managerSignedName: null, managerSignedTitle: null, managerSignedAt: null, filedAt: null },
      });
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

    // save / sign — "sign" captures the auditor's (Director of Field Ops)
    // signature and routes the audit to the branch manager for theirs.
    const branch = str(body?.branch);
    if (!branch) return NextResponse.json({ error: "Select a branch." }, { status: 400 });
    const visit = date(body?.visitDate) ?? new Date();
    const year = int(body?.year) ?? visit.getFullYear();
    const quarter = int(body?.quarter) ?? Math.floor(visit.getMonth() / 3) + 1;
    const facility: Facility = (body?.facility ?? {}) as Facility;
    const personnel: YesNo = (body?.personnel ?? {}) as YesNo;
    const ratings: Ratings5 = (body?.ratings ?? {}) as Ratings5;
    const { score, maxScore, scorePct } = scoreAudit(facility, personnel, ratings);
    // "submit" kept as a back-compat alias for the pre-signature flow.
    const sign = action === "sign" || action === "submit";

    const existing = await prisma.branchAudit.findUnique({ where: { branch_year_quarter: { branch, year, quarter } } });
    if (existing && existing.status === "signed")
      return NextResponse.json({ error: "This audit is already signed and filed. Reopen it from the audit to make changes." }, { status: 409 });

    const auditorName = str(body?.auditorName) ?? user.name;

    const data = {
      branch,
      year,
      quarter,
      visitDate: visit,
      auditorName,
      status: sign ? "pending_manager" : "draft",
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
      submittedAt: sign ? new Date() : null,
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

    // On sign: capture the auditor's signature, resolve + link both profiles,
    // mint the manager's sign token, and email the branch manager a link to
    // review, acknowledge and sign (which files the completed form).
    let emailStatus: string | null = null;
    if (sign) {
      const [mgrEmp, auditorEmp] = await Promise.all([managerEmployeeForBranch(branch), fieldOpsEmployee()]);
      const mgrUser = await prisma.user.findFirst({ where: { role: "manager", branch } });
      const token = existing?.managerSignToken ?? newSignToken();
      await prisma.branchAudit.update({
        where: { id: audit.id },
        data: {
          auditorName,
          auditorEmployeeId: auditorEmp?.id ?? null,
          auditorSignedName: str(body?.auditorSignedName) ?? auditorName,
          auditorSignedAt: existing?.auditorSignedAt ?? new Date(),
          managerEmployeeId: mgrEmp?.id ?? null,
          managerName: mgrEmp?.name ?? mgrUser?.name ?? null,
          managerSignToken: token,
        },
      });

      const label = branchLabel(branch);
      const base = reqBase(req);
      const link = `${base}/audit-sign/${token}`;
      const savedFollowUps = await prisma.auditFollowUp.findMany({ where: { auditId: audit.id } });
      const fuList = savedFollowUps.map((f) => `• ${f.description}${f.dueDate ? ` (due ${f.dueDate.toLocaleDateString()})` : ""}`).join("\n");
      const res = await sendEmail({
        to: mgrUser?.email,
        subject: `Action needed — sign your ${auditTitle({ branch, year, quarter })} (${scorePct}%)`,
        kind: "audit_manager_sign",
        relatedType: "branch_audit",
        relatedId: audit.id,
        text: `The Q${quarter} ${year} field-operations audit for ${label} was completed and signed by ${auditorName}.\n\nBranch compliance score: ${score}/${maxScore} (${scorePct}%).\n${fuList ? `\nAction items before next visit:\n${fuList}\n` : ""}\nPlease review and sign to acknowledge:\n${link}\n\nYour signature files the completed audit to the Branch Hub and your profile. The action items already appear on your dashboard with their deadlines.\n\n— CanopyOS`,
        html: `<p>The <strong>Q${quarter} ${year}</strong> field-operations audit for <strong>${label}</strong> was completed and signed by ${auditorName}.</p><p style="font-size:18px"><strong>Branch compliance score: ${score}/${maxScore} (${scorePct}%)</strong></p>${fuList ? `<p><strong>Action items before next visit:</strong></p><ul>${savedFollowUps.map((f) => `<li>${f.description}${f.dueDate ? ` <em>(due ${f.dueDate.toLocaleDateString()})</em>` : ""}</li>`).join("")}</ul>` : ""}<p><a href="${link}" style="display:inline-block;background:#2e6f47;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review &amp; sign the audit →</a></p><p>Your signature files the completed audit to the Branch Hub and your profile. The action items already appear on your dashboard with their deadlines.</p><p>— CanopyOS</p>`,
      });
      emailStatus = res.status;
    }

    return NextResponse.json({ ok: true, id: audit.id, score, maxScore, scorePct, status: data.status, emailStatus });
  } catch (e) {
    return fail(e);
  }
}
