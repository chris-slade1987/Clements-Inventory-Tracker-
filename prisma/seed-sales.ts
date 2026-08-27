import type { PrismaClient } from "@prisma/client";

// Sales Team access + demo data, applied on deploy. Idempotent and safe:
//  1. Every "Service Advisor" login gets the `sales` access level (self-service
//     sales dashboard + goal planner) — never downgrades a manager/admin.
//  2. The Sales Director (Howard Cohn / "Dir. of Sales") gets the focused
//     `sales_director` access level (cross-branch sales oversight).
//  3. A filled example goal sheet is created for Josh Flagg for the current
//     month IF he has none yet — so the director dashboard shows real numbers.
//     Never overwrites a sheet the advisor already entered.

function currentPeriodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function seedSalesTeamAccess(prisma: PrismaClient) {
  // 1) Service advisors → sales access level.
  const advisors = await prisma.employee.findMany({
    where: { status: "active", role: { contains: "Service Advisor" }, user: { isNot: null } },
    select: { id: true, name: true, branch: true, user: { select: { id: true, accessLevel: true, role: true } } },
  });
  let updated = 0;
  for (const a of advisors) {
    const u = a.user;
    if (!u) continue;
    if (u.role === "admin" || u.role === "manager") continue; // don't downgrade a leader
    if (u.accessLevel === "sales") continue;
    await prisma.user.update({ where: { id: u.id }, data: { accessLevel: "sales", role: "employee" } });
    updated++;
  }

  // 2) Sales Director → sales_director access level (focused cross-branch view).
  let directorSet: string | null = null;
  const director = await prisma.employee.findFirst({
    where: { status: "active", OR: [{ role: { contains: "Dir. of Sales" } }, { name: { contains: "Howard Cohn" } }], user: { isNot: null } },
    select: { name: true, user: { select: { id: true, accessLevel: true } } },
  });
  if (director?.user && director.user.accessLevel !== "sales_director") {
    await prisma.user.update({ where: { id: director.user.id }, data: { accessLevel: "sales_director", role: "manager" } });
    directorSet = director.name;
  }

  // 3) Example goal sheet for Josh Flagg (current month), only if none exists.
  const periodKey = currentPeriodKey();
  let exampleCreated = false;
  const josh = await prisma.employee.findFirst({ where: { name: { contains: "Josh Flagg" } }, select: { id: true, branch: true } });
  if (josh) {
    const existing = await prisma.salesGoalSheet.findUnique({ where: { advisorEmployeeId_periodKey: { advisorEmployeeId: josh.id, periodKey } } });
    if (!existing) {
      await prisma.salesGoalSheet.create({
        data: {
          advisorEmployeeId: josh.id, periodKey, branch: josh.branch,
          reis: 40, appts: 60, proposals: 30, pcExposed: 5000, pcSold: 2000, tcSold: 30000, totalExposure: 125000, tcUnits: 12,
          salesGoal: 50000, workdays: 20,
        },
      });
      exampleCreated = true;
    }
  }

  return { advisors: advisors.length, updated, directorSet, exampleCreated, periodKey };
}

// Standalone: `tsx prisma/seed-sales.ts`
if (process.argv[1] && process.argv[1].includes("seed-sales")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      console.log("seed-sales:", JSON.stringify(await seedSalesTeamAccess(prisma)));
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
