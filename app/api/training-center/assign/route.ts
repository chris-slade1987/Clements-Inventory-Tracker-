import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canViewCertifications } from "@/lib/certifications";
import { confirmAssignment, assignNextAdvancementStep } from "@/lib/training-assign";
import { fail, HttpError } from "@/lib/http";

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
      return NextResponse.json({ ok: true, advancement: true, ...result });
    }

    if (!moduleCode && !standaloneCourseCode)
      throw new HttpError("Pick a module or a single course to assign.");

    const result = await confirmAssignment(prisma, { ...common, moduleCode, programCode, standaloneCourseCode });
    return NextResponse.json({ ok: true, advancement: false, assignmentId: result.assignmentId, preview: result.preview });
  } catch (e) {
    return fail(e);
  }
}
