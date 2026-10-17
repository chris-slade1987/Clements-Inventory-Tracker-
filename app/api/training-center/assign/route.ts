import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canViewCertifications } from "@/lib/certifications";
import { confirmAssignment, assignNextAdvancementStep } from "@/lib/training-assign";
import { fail, HttpError } from "@/lib/http";
import { sendEmail } from "@/lib/email";
import { postSystemThread, employeeRecipient } from "@/lib/threads";

/** Notify an employee that training was assigned — reliable Inbox notice plus
 *  email. Best-effort: a failed notice never fails the assignment. */
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
    });
    if (recip.email) {
      await sendEmail({
        to: recip.email,
        subject: `New training assigned: ${what}`,
        kind: "training_assigned",
        relatedType: "module_assignment",
        relatedId: employeeId,
        text: `Hi ${recip.name.split(" ")[0]},\n\nYou've been assigned ${what}. Open My Training to get started.\n\n— CanopyOS`,
        html: `<p>Hi ${recip.name.split(" ")[0]},</p><p>You've been assigned <strong>${what}</strong>. Open My Training to get started.</p><p>— CanopyOS</p>`,
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
