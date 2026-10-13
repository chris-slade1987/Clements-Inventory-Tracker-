import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canViewCertifications } from "@/lib/certifications";
import { completeCourse } from "@/lib/training-assign";
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
    const courseCode = typeof body?.courseCode === "string" ? body.courseCode : "";
    if (!employeeId || !courseCode) throw new HttpError("Missing employee or course.");
    const scoreRaw = body?.score;
    const score = scoreRaw === null || scoreRaw === undefined || scoreRaw === "" ? null : Number(scoreRaw);
    if (score !== null && !Number.isFinite(score)) throw new HttpError("Score must be a number.");

    const result = await completeCourse(prisma, {
      employeeId,
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
