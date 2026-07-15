import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hashPassword, MANAGER_PASSWORD } from "./seed-core";

// Seeds a demo new-hire and their 30 / 60-day reviews so the workflow is
// immediately visible: HR has a review to assign, a manager has one to conduct,
// and the new hire has one to sign. Idempotent (matched by email).
export async function seedReviews(prisma: PrismaClient) {
  const email = "jordan.rivera@clementspestcontrol.com";
  const now = new Date();
  const hireDate = new Date(now.getTime() - 40 * 864e5); // hired 40 days ago

  // Demo new hire at Vero, with a login linked to the profile.
  let employee = await prisma.employee.findFirst({ where: { email } });
  if (!employee) {
    employee = await prisma.employee.create({
      data: { name: "Jordan Rivera", email, role: "Technician", division: "Service", branch: "vero", status: "active", hireDate },
    });
  } else {
    employee = await prisma.employee.update({ where: { id: employee.id }, data: { hireDate, status: "active" } });
  }
  const login = await prisma.user.findUnique({ where: { email } });
  if (!login) {
    await prisma.user.create({ data: { name: employee.name, email, passwordHash: hashPassword(MANAGER_PASSWORD), role: "employee", branch: "vero", employeeId: employee.id } });
  } else if (!login.employeeId) {
    await prisma.user.update({ where: { id: login.id }, data: { employeeId: employee.id } });
  }

  // The Vero manager conducts the review.
  const reviewer = await prisma.user.findFirst({ where: { branch: "vero", role: "manager" } });

  const due30 = new Date(hireDate.getTime() + 30 * 864e5);
  const due60 = new Date(hireDate.getTime() + 60 * 864e5);

  // 30-day: already sent to the manager, awaiting signatures.
  const has30 = await prisma.newHireReview.findUnique({ where: { employeeId_type: { employeeId: employee.id, type: "30_day" } } });
  if (!has30) {
    await prisma.newHireReview.create({
      data: {
        employeeId: employee.id, branch: "vero", type: "30_day", startDate: hireDate, dueDate: due30,
        status: "sent", reviewerUserId: reviewer?.id ?? null, reviewerName: reviewer?.name ?? null,
        employeeToken: randomBytes(24).toString("hex"), hrNotifiedAt: now, sentAt: now,
      },
    });
  } else if (reviewer && has30.reviewerUserId !== reviewer.id) {
    // Re-runs recreate users (new ids) but keep reviews — relink the reviewer.
    await prisma.newHireReview.update({ where: { id: has30.id }, data: { reviewerUserId: reviewer.id, reviewerName: reviewer.name } });
  }

  // 60-day: just reached its mark — awaiting HR to assign a reviewer.
  const has60 = await prisma.newHireReview.findUnique({ where: { employeeId_type: { employeeId: employee.id, type: "60_day" } } });
  if (!has60) {
    await prisma.newHireReview.create({
      data: { employeeId: employee.id, branch: "vero", type: "60_day", startDate: hireDate, dueDate: due60, status: "due", hrNotifiedAt: now },
    });
  }

  console.log(`Seeded demo new-hire reviews for ${employee.name} (${email}).`);
  return { employee: employee.name };
}

if (process.argv[1] && process.argv[1].includes("seed-reviews")) {
  const prisma = new PrismaClient();
  seedReviews(prisma)
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
