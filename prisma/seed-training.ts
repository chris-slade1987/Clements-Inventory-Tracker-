import { PrismaClient } from "@prisma/client";

// A sample monthly CEU course + assignments, so the training flow has data on a
// fresh install. Idempotent: only seeds when no courses exist yet.
const SAMPLE = {
  title: "Monthly Safety Refresher — Pesticide Handling",
  category: "ceu",
  description:
    "This month's refresher covers safe pesticide handling and storage per FDACS / FL Statute 482 and OSHA HazCom. Review the material, then complete the short quiz. A passing score is 80%.",
  passingScore: 80,
  questions: [
    { prompt: "Pesticide concentrates must be stored in…", options: ["Any available container", "Their original, labeled containers", "Unlabeled spare jugs"], correctIndex: 1 },
    { prompt: "Before handling concentrates, you should always…", options: ["Skip PPE if you're in a hurry", "Put on the required PPE (gloves, goggles, respirator)", "Wait for a manager"], correctIndex: 1 },
    { prompt: "If a spill occurs, the first step is to…", options: ["Leave it for the next shift", "Use the spill kit to contain it", "Hose it into the drain"], correctIndex: 1 },
    { prompt: "Safety Data Sheets (SDS) must be…", options: ["Accessible for all products on site", "Kept only at headquarters", "Optional for pest control"], correctIndex: 0 },
  ],
};

export async function seedTraining(prisma: PrismaClient) {
  const existing = await prisma.course.count();
  if (existing > 0) return { created: 0, assigned: 0 };

  const course = await prisma.course.create({
    data: {
      title: SAMPLE.title,
      category: SAMPLE.category,
      description: SAMPLE.description,
      passingScore: SAMPLE.passingScore,
      questions: JSON.stringify(SAMPLE.questions),
    },
  });

  // Assign to every active Vero Beach employee as a demo cohort.
  const cohort = await prisma.employee.findMany({ where: { status: "active", branch: "vero" } });
  const due = new Date(Date.UTC(2026, 6, 31)); // Jul 31 2026
  let assigned = 0;
  for (const e of cohort) {
    await prisma.trainingAssignment.create({
      data: { courseId: course.id, employeeId: e.id, branch: e.branch, dueDate: due, notifiedAt: new Date() },
    });
    assigned++;
  }
  console.log(`Seeded training: 1 course, ${assigned} assignments.`);
  return { created: 1, assigned };
}

if (process.argv[1] && process.argv[1].includes("seed-training")) {
  const prisma = new PrismaClient();
  seedTraining(prisma).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
