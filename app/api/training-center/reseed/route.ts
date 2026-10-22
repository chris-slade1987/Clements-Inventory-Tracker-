import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// Load / repair the Training Center catalog on demand (admin only). The deploy
// seed runs this too, but it's non-fatal there — so if it ever failed silently in
// an environment, this button re-runs it and reports the REAL error instead of
// leaving the Certifications tab empty. Idempotent (all upserts).
export async function POST() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { seedTrainingCatalog } = await import("@/prisma/seed-training-catalog");
    await seedTrainingCatalog(prisma);
    const [certifications, courses, withContent] = await Promise.all([
      prisma.certification.count(),
      prisma.certCourse.count(),
      prisma.certCourse.count({ where: { contentUrl: { not: null } } }),
    ]);
    return NextResponse.json({ ok: true, certifications, courses, coursesWithContent: withContent });
  } catch (e) {
    // Surface the real reason so we can fix it (e.g. a missing column / FK issue).
    return NextResponse.json({ error: (e as Error)?.message ?? "Seed failed", stack: (e as Error)?.stack?.split("\n").slice(0, 4).join(" | ") }, { status: 500 });
  }
}
