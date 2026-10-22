import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canManageAccessRights } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 60;

// On-demand "repair the org chart" (super admins only). Runs the SAME seeds the
// deploy runs — pin Chris + Tim to the top, and apply the Corporate Contact &
// Reference Sheet role details to every matching employee — but HERE, in the live
// runtime against the live database (the build-time seed doesn't reliably persist
// to prod, same as the Training Center catalog). Returns a diagnostic of what it
// found + did so we can see the real records. Idempotent.
export async function POST() {
  const user = await getSessionUser();
  if (!user || !canManageAccessRights(user)) {
    return NextResponse.json({ error: "Super admins only." }, { status: 403 });
  }
  try {
    const { seedLeadershipRoots } = await import("@/prisma/seed-org-chart");
    const { seedCorporateRoles } = await import("@/prisma/seed-corporate-roles");

    const roots = await seedLeadershipRoots(prisma);
    const roles = await seedCorporateRoles(prisma, { force: true });

    // Diagnostic: show the actual records for a few people so we can see duplicates
    // and confirm what landed.
    const sample = async (q: string) =>
      (await prisma.employee.findMany({
        where: { name: { contains: q } },
        select: { id: true, name: true, email: true, status: true, reportsToId: true, roleResponsibilities: true },
      })).map((e) => ({
        id: e.id,
        name: e.name,
        email: e.email,
        status: e.status,
        reportsToId: e.reportsToId,
        hasRole: !!e.roleResponsibilities,
      }));

    const diagnostics = {
      Slade: await sample("Slade"),
      Williford: await sample("Williford"),
      Glanville: await sample("Glanville"),
      Berning: await sample("Berning"),
      Sanderson: await sample("Sanderson"),
    };

    return NextResponse.json({ ok: true, roots, roles, diagnostics });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Repair failed", stack: (e as Error)?.stack?.split("\n").slice(0, 5).join(" | ") },
      { status: 500 },
    );
  }
}
