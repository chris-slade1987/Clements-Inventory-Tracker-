import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { saveUpload } from "@/lib/storage";
import { isHrDirector } from "@/lib/personnel";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/app-url";
import { type SeparationDoc, syncTechnicianActiveForEmployee } from "@/lib/separation";

export const runtime = "nodejs";
export const maxDuration = 20;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const bool = (v: unknown) => v === true || v === "true" || v === "on" || v === "yes";
const intIn = (v: unknown, min: number, max: number) => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "").trim(), 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const dateOf = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d; };

// Employee lifecycle for HR: add a profile, terminate (with reason, supporting
// docs & exit-interview handling), record/bypass the exit interview, and
// reactivate. All linked data is retained — termination only flips the profile
// to inactive and disables the linked login.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && !isHrDirector(user)))
    return NextResponse.json({ error: "Only HR or an admin can manage employee records." }, { status: 403 });

  const ct = req.headers.get("content-type") ?? "";
  const isForm = ct.includes("multipart/form-data");
  const form = isForm ? await req.formData().catch(() => null) : null;
  const json = isForm ? null : await req.json().catch(() => null);
  const get = (k: string): unknown => (isForm ? form?.get(k) ?? null : json?.[k]);
  const action = s(get("action"));

  try {
    // ---- add a new employee profile ----------------------------------------
    if (action === "create") {
      const name = s(get("name"));
      if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
      const emp = await prisma.employee.create({
        data: {
          name,
          email: s(get("email")),
          phone: s(get("phone")),
          personalPhone: s(get("personalPhone")),
          personalEmail: s(get("personalEmail")),
          role: s(get("role")),
          division: s(get("division")),
          branch: s(get("branch")),
          title: s(get("title")),
          birthMonth: intIn(get("birthMonth"), 1, 12),
          birthDay: intIn(get("birthDay"), 1, 31),
          hireDate: dateOf(get("hireDate")),
          status: "active",
        },
      });
      return NextResponse.json({ ok: true, id: emp.id });
    }

    const employeeId = s(get("employeeId"));
    if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });
    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true } });
    if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

    // ---- terminate / offboard ----------------------------------------------
    if (action === "terminate") {
      if (employee.user && employee.user.id === user.id)
        return NextResponse.json({ error: "You can't offboard your own account." }, { status: 400 });
      const separationType = s(get("separationType"));
      const lastDay = dateOf(get("lastDay")) ?? new Date();
      if (!separationType) return NextResponse.json({ error: "Choose the separation type." }, { status: 400 });

      // Store any supporting documents (multipart only).
      const docs: SeparationDoc[] = [];
      if (form) {
        const files = form.getAll("docs").filter((f): f is File => f instanceof File && f.size > 0);
        for (const file of files) {
          const url = await saveUpload(Buffer.from(await file.arrayBuffer()), file.name || "document", file.type || "application/octet-stream", "separation-docs");
          if (url) docs.push({ file: url, name: file.name || "document" });
        }
      }

      const bypass = bool(get("bypassExit"));
      const data = {
        separationType,
        reasonCategory: s(get("reasonCategory")),
        reasonNotes: s(get("reasonNotes")),
        lastDay,
        rehireEligible: get("rehireEligible") == null || s(get("rehireEligible")) == null ? null : bool(get("rehireEligible")),
        docs: JSON.stringify(docs),
        exitStatus: bypass ? "bypassed" : "pending",
        exitBypassReason: bypass ? s(get("bypassReason")) : null,
        createdByUserId: user.id,
        createdByName: user.name,
      };
      await prisma.employeeSeparation.upsert({
        where: { employeeId },
        create: { employeeId, ...data },
        update: data,
      });
      await prisma.employee.update({ where: { id: employeeId }, data: { status: "inactive", terminatedAt: lastDay } });
      // Disable the linked login so a former employee can't sign in.
      if (employee.user) await prisma.user.update({ where: { id: employee.user.id }, data: { active: false } });
      // Remove them from the check-out (chemical dispersement) roster.
      await syncTechnicianActiveForEmployee(employee.name, false);
      return NextResponse.json({ ok: true });
    }

    // ---- record or bypass the exit interview -------------------------------
    if (action === "exit") {
      const sep = await prisma.employeeSeparation.findUnique({ where: { employeeId } });
      if (!sep) return NextResponse.json({ error: "Terminate the employee first." }, { status: 400 });
      const mode = s(get("mode")); // "complete" | "bypass"
      if (mode === "bypass") {
        await prisma.employeeSeparation.update({ where: { employeeId }, data: { exitStatus: "bypassed", exitBypassReason: s(get("bypassReason")) } });
        return NextResponse.json({ ok: true });
      }
      const responses = json?.responses && typeof json.responses === "object" ? JSON.stringify(json.responses) : sep.exitResponses;
      await prisma.employeeSeparation.update({
        where: { employeeId },
        data: { exitResponses: responses, exitStatus: "completed", exitInterviewAt: new Date(), exitInterviewBy: user.name },
      });
      return NextResponse.json({ ok: true });
    }

    // ---- send the exit interview to the former employee's PERSONAL email ----
    // Company email is cut off at termination, so the self-serve exit interview
    // goes to the personal address on the profile. Super admins only.
    if (action === "sendExitInterview") {
      if (!isSuperAdmin(user)) return NextResponse.json({ error: "Only a super admin can send the exit interview." }, { status: 403 });
      const sep = await prisma.employeeSeparation.findUnique({ where: { employeeId } });
      if (!sep) return NextResponse.json({ error: "Terminate the employee first." }, { status: 400 });
      if (sep.exitStatus === "completed") return NextResponse.json({ error: "The exit interview is already completed." }, { status: 400 });
      const personalEmail = (employee.personalEmail ?? "").trim();
      if (!personalEmail) return NextResponse.json({ error: "No personal email on file — add one on the employee profile first." }, { status: 400 });
      const token = sep.exitToken ?? randomBytes(24).toString("hex");
      await prisma.employeeSeparation.update({ where: { employeeId }, data: { exitToken: token, exitSentAt: new Date(), exitSentTo: personalEmail } });
      const link = `${appUrl()}/exit-interview/${token}`;
      const first = employee.name.split(" ")[0];
      const res = await sendEmail({
        to: personalEmail,
        subject: "Clements Pest Control — exit interview",
        kind: "exit_interview",
        relatedType: "employee_separation",
        relatedId: sep.id,
        text: `Hi ${first},\n\nThank you for your time at Clements Pest Control. We'd appreciate a few minutes to complete a short exit interview — your feedback helps us improve.\n\nComplete it here: ${link}\n\n— Clements Pest Control`,
        html: `<p>Hi ${first},</p><p>Thank you for your time at Clements Pest Control. We'd appreciate a few minutes to complete a short <strong>exit interview</strong> — your feedback helps us improve.</p><p><a href="${link}">Open the exit interview →</a></p><p>— Clements Pest Control</p>`,
      });
      return NextResponse.json({ ok: true, to: personalEmail, sent: res.status });
    }

    // ---- reactivate (rehire / correction) ----------------------------------
    if (action === "reactivate") {
      await prisma.employeeSeparation.deleteMany({ where: { employeeId } });
      await prisma.employee.update({ where: { id: employeeId }, data: { status: "active", terminatedAt: null } });
      if (employee.user) await prisma.user.update({ where: { id: employee.user.id }, data: { active: true } });
      // Restore them to the check-out (chemical dispersement) roster.
      await syncTechnicianActiveForEmployee(employee.name, true);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    const msg = (e as { code?: string }).code === "P2002" ? "That email is already on another profile." : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
