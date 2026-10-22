import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canViewCertifications } from "@/lib/certifications";
import { confirmAssignment, assignNextAdvancementStep } from "@/lib/training-assign";
import { fail, HttpError } from "@/lib/http";
import { sendEmail } from "@/lib/email";
import { postSystemThread, employeeRecipient } from "@/lib/threads";
import { appUrl } from "@/lib/app-url";

/** Notify an employee that training was assigned: an in-app Inbox notice PLUS one
 *  purpose-built email with a direct link to their Employee Hub training. The
 *  Inbox thread is created WITHOUT its generic "New discussion" email (the single
 *  training email below replaces it). Best-effort — a failed notice never fails
 *  the assignment. */
async function notifyTrainingAssigned(employeeId: string, what: string, branch: string | null) {
  try {
    const recip = await employeeRecipient(employeeId);
    if (!recip) return;
    const body = `You've been assigned ${what}. Open My Training to get started — your progress and any sign-offs are tracked there.`;
    await postSystemThread({
      subject: "New training assigned",
      body,
      recipients: [recip],
      contextType: "reminder",
      contextLabel: "Training assigned",
      contextHref: "/me/training",
      branch,
      emailParticipants: false, // the dedicated training email below is sent instead
    });
    if (recip.email) {
      // Deep-link straight to the employee's Training & Certificates area.
      const hubLink = `${appUrl()}/me/training`;
      const first = recip.name.split(" ")[0];
      const button = appUrl()
        ? `<p style="margin:16px 0"><a href="${hubLink}" style="background:#146A3A;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open my Training &amp; Certificates</a></p>`
        : "";
      await sendEmail({
        to: recip.email,
        subject: `New training assigned: ${what}`,
        kind: "training_assigned",
        relatedType: "module_assignment",
        relatedId: employeeId,
        text: `Hi ${first},\n\nYou've been assigned ${what}.\n\nOpen your Training & Certificates in the Employee Hub to get started:\n${hubLink}\n\n— CanopyOS`,
        html: `<p>Hi ${first},</p><p>You've been assigned <strong>${what}</strong>.</p><p>Open your <strong>Training &amp; Certificates</strong> in the Employee Hub to get started.</p>${button}<p style="margin:12px 0 0;font-size:12px;color:#889">— CanopyOS</p>`,
      });
    }
  } catch {
    /* non-fatal */
  }
}

export const runtime = "nodejs";
export const maxDuration = 20;

const ADVANCEMENT_PROGRAMS = new Set(["PRG-SLS", "PRG-MGT"]);

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewCertifications(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => null);
    const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
    if (!employeeId) throw new HttpError("Pick an employee.");
    const moduleCode = typeof body?.moduleCode === "string" && body.moduleCode ? body.moduleCode : undefined;
    const programCode = typeof body?.programCode === "string" && body.programCode ? body.programCode : undefined;
    const standaloneCourseCode =
      typeof body?.standaloneCourseCode === "string" && body.standaloneCourseCode ? body.standaloneCourseCode : undefined;
    const overridePacing = body?.overridePacing === true;

    // The employee's branch rides along on the assignment for branch reporting.
    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { branch: true } });
    if (!employee) throw new HttpError("Unknown employee.");

    const common = {
      employeeId,
      assignedById: user.id,
      assignedByName: user.name,
      branch: employee.branch ?? null,
      overridePacing,
    };

    // Advancement programs (PRG-SLS / PRG-MGT) with no explicit module → assign the
    // next incomplete step via the advancement engine.
    if (programCode && ADVANCEMENT_PROGRAMS.has(programCode) && !moduleCode) {
      const result = await assignNextAdvancementStep(prisma, { ...common, programCode });
      if (!result.assignedModuleCode)
        return NextResponse.json({
          ok: true,
          advancement: true,
          assignedModuleCode: null,
          skipped: result.skipped,
          message: "Every step of this advancement program is already complete.",
        });
      await notifyTrainingAssigned(employeeId, `the next step of the ${programCode} program (module ${result.assignedModuleCode})`, employee.branch ?? null);
      return NextResponse.json({ ok: true, advancement: true, ...result });
    }

    if (!moduleCode && !standaloneCourseCode)
      throw new HttpError("Pick a module or a single course to assign.");

    const result = await confirmAssignment(prisma, { ...common, moduleCode, programCode, standaloneCourseCode });
    await notifyTrainingAssigned(employeeId, moduleCode ? `the ${moduleCode} training module` : `the ${standaloneCourseCode} course`, employee.branch ?? null);
    return NextResponse.json({ ok: true, advancement: false, assignmentId: result.assignmentId, preview: result.preview });
  } catch (e) {
    return fail(e);
  }
}
