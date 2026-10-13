import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canViewCertifications } from "@/lib/certifications";
import { approveFieldSignoff } from "@/lib/training-assign";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewCertifications(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => null);
    const action = body?.action === "approve" ? "approve" : "create";

    if (action === "approve") {
      const signoffId = typeof body?.signoffId === "string" ? body.signoffId : "";
      if (!signoffId) throw new HttpError("Missing sign-off.");
      const result = await approveFieldSignoff(prisma, {
        signoffId,
        approvedByName: user.name,
        approvedByUserId: user.id,
      });
      return NextResponse.json({ ok: true, awarded: result.awarded });
    }

    // create
    const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
    const courseCode = typeof body?.courseCode === "string" ? body.courseCode : "";
    if (!employeeId || !courseCode) throw new HttpError("Missing employee or course.");

    const course = await prisma.certCourse.findUnique({
      where: { code: courseCode },
      select: { id: true, certificationId: true, courseType: true },
    });
    if (!course) throw new HttpError("Unknown course.");
    if (course.courseType !== "field_signoff")
      throw new HttpError("Field sign-offs can only be logged for a field sign-off course.");

    const hoursRaw = body?.hours;
    const hours = hoursRaw === null || hoursRaw === undefined || hoursRaw === "" ? null : Number(hoursRaw);
    if (hours !== null && !Number.isFinite(hours)) throw new HttpError("Hours must be a number.");
    const dateRaw = typeof body?.date === "string" && body.date ? body.date : null;
    const date = dateRaw ? new Date(dateRaw) : new Date();
    if (Number.isNaN(date.getTime())) throw new HttpError("Invalid date.");

    const created = await prisma.fieldSignoff.create({
      data: {
        employeeId,
        courseId: course.id,
        certificationId: course.certificationId,
        date,
        hours,
        trainerName: typeof body?.trainerName === "string" && body.trainerName ? body.trainerName : null,
        trainerUserId: user.id,
        note: typeof body?.note === "string" && body.note ? body.note : null,
        approved: false,
      },
    });
    return NextResponse.json({ ok: true, signoffId: created.id });
  } catch (e) {
    return fail(e);
  }
}
