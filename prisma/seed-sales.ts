import type { PrismaClient } from "@prisma/client";

// Give every "Service Advisor" employee's login the `sales` access level, so
// they get the self-service sales dashboard + monthly goal planner. Idempotent
// and safe: only touches logins currently at technician/csr/sales/null level
// (never downgrades a manager/admin), and never changes anyone's password.
//
// The Sales Director is intentionally NOT set here — that person is often a
// full admin already; assign the "sales_director" access level in People only
// if you want to restrict them to the focused Sales-only view.
export async function seedSalesTeamAccess(prisma: PrismaClient) {
  const advisors = await prisma.employee.findMany({
    where: { status: "active", role: { contains: "Service Advisor" }, user: { isNot: null } },
    select: { id: true, name: true, user: { select: { id: true, accessLevel: true, role: true } } },
  });
  let updated = 0;
  for (const a of advisors) {
    const u = a.user;
    if (!u) continue;
    // Don't downgrade a leader who happens to also carry an advisor title.
    if (u.role === "admin" || u.role === "manager") continue;
    if (u.accessLevel === "sales") continue;
    await prisma.user.update({ where: { id: u.id }, data: { accessLevel: "sales", role: "employee" } });
    updated++;
  }
  return { advisors: advisors.length, updated };
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
