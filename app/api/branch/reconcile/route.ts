import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { seedBranchHub } from "@/prisma/seed-branch";

export const runtime = "nodejs";
export const maxDuration = 20;

// Repair / reconcile the branch-hub documents on the live database. Runs the
// same idempotent seed the deploy uses: assigns each certified operator to the
// branch they certify (Chris → Naples, Adam → Stuart, Graham → Orlando),
// restores any missing operator, business license, or lease, and never touches
// a doc a manager uploaded. Safe to run repeatedly. Admin/manager only.
export async function POST() {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const res = await seedBranchHub(prisma);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
