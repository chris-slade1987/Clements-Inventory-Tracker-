import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { completeCourse } from "@/lib/training-assign";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

// Self-service course completion: an employee records that THEY finished a course
// that's assigned to them. Unlike the admin progress route (which marks completion
// for anyone), this only ever writes the signed-in person's own record, and only
// for a course they're actually assigned (a courseProgress row exists). Flows
// through completeCourse → updates progress, auto-completes the module when every
// course is done, and checks the certification award.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!user.employeeId) return NextResponse.json({ error: "No employee profile linked." }, { status: 403 });

  try {
    const body = await req.json().catch(() => null);
    const courseCode = typeof body?.courseCode === "string" ? body.courseCode.toUpperCase() : "";
    if (!courseCode) throw new HttpError("Missing course.");
    const scoreRaw = body?.score;
    const score = scoreRaw === null || scoreRaw === undefined || scoreRaw === "" ? null : Number(scoreRaw);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new HttpError("Score must be 0–100.");

    const course = await prisma.certCourse.findUnique({ where: { code: courseCode }, select: { id: true, courseType: true } });
    if (!course) throw new HttpError("Unknown course.");
    // Field sign-offs are completed in the field by a trainer — not self-recorded.
    if (course.courseType === "field_signoff") throw new HttpError("Field sign-off courses are recorded by your trainer, not here.");

    // Must be assigned to this person (assignment seeds a courseProgress row).
    const progress = await prisma.courseProgress.findUnique({
      where: { employeeId_courseId: { employeeId: user.employeeId, courseId: course.id } },
      select: { status: true },
    });
    if (!progress) throw new HttpError("This course isn't assigned to you.", 403);

    const result = await completeCourse(prisma, {
      employeeId: user.employeeId,
      courseCode,
      score,
      approvedByName: user.name,
      approvedByUserId: user.id,
    });
    return NextResponse.json({ ok: true, awarded: result.awarded });
  } catch (e) {
    return fail(e);
  }
}
