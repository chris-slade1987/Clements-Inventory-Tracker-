import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { seedTrainingGhp } from "@/prisma/seed-training-ghp";

export const runtime = "nodejs";
export const maxDuration = 30;

// Runtime "Load / refresh the August GHP course" action for admins. Runs the
// same idempotent seed against the LIVE database, so the course appears even if
// the build-time deploy seed didn't run (or ran against a different DB). Content
// is embedded in code (lib/ghp-course.ts) — no file read — so it works in the
// serverless runtime. Also retires the old demo sample course.
export async function POST() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const r = await seedTrainingGhp(prisma);
    const sample = await prisma.course.findFirst({ where: { title: "Monthly Safety Refresher — Pesticide Handling" } });
    let retiredSample = false;
    if (sample) {
      await prisma.trainingAssignment.deleteMany({ where: { courseId: sample.id } });
      await prisma.course.delete({ where: { id: sample.id } });
      retiredSample = true;
    }
    return NextResponse.json({ ok: true, retiredSample, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
