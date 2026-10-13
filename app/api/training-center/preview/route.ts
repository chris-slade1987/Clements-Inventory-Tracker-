import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canViewCertifications } from "@/lib/certifications";
import { previewAssignment } from "@/lib/training-assign";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

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
    if (!moduleCode && !standaloneCourseCode)
      throw new HttpError("Pick a module or a single course to preview.");

    const preview = await previewAssignment(prisma, { employeeId, moduleCode, programCode, standaloneCourseCode });
    return NextResponse.json({ ok: true, preview });
  } catch (e) {
    return fail(e);
  }
}
