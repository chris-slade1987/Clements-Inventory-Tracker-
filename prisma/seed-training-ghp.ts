import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

// Seeds the August 2026 GHP CEU course — "Roach Identification — The Clements
// Way" — a fully built-out lesson (rich Markdown body + inline diagrams under
// public/training/ghp-august) plus its 20-question assessment.
//
// Idempotent by title: the course is CREATED when missing and its content
// (body, quiz, passing score, category) is REFRESHED on every deploy, so a
// content fix ships without duplicating the course. Assignments are handed to
// every active technician who doesn't already have one — never re-created, so
// completed attempts and grades are preserved.

const COURSE_TITLE = "Roach Identification — The Clements Way (August 2026)";
const BODY_FILE = "ghp-roach-id-aug2026.md";
const PASSING_SCORE = 80;
const DUE = new Date(Date.UTC(2026, 7, 31)); // Aug 31 2026

// True/False options are ["True", "False"] → correctIndex 0 = True, 1 = False.
const TF = ["True", "False"];
const QUESTIONS = [
  // Part 1 — True / False
  { prompt: "Seeing a cockroach in the middle of the day usually means the infestation is small.", options: TF, correctIndex: 1 },
  { prompt: "The German cockroach is identified by two dark stripes running lengthwise behind its head.", options: TF, correctIndex: 0 },
  { prompt: "A cockroach nymph looks like a small, wingless version of the adult.", options: TF, correctIndex: 0 },
  { prompt: "Because eggs are protected inside the ootheca, a single treatment often does not end a German roach problem.", options: TF, correctIndex: 0 },
  { prompt: "Oriental cockroaches respond well to gel bait placed in the kitchen.", options: TF, correctIndex: 1 },
  { prompt: "Crickets and cockroaches can be told apart because crickets have large jumping legs and roaches do not.", options: TF, correctIndex: 0 },
  { prompt: "A clean home cannot get a roach infestation.", options: TF, correctIndex: 1 },
  { prompt: "Brown-banded cockroaches are best controlled with floor-level treatment only.", options: TF, correctIndex: 1 },
  { prompt: "A strong musty, oily odor in a home can indicate a large or long-standing roach population.", options: TF, correctIndex: 0 },
  { prompt: "Killing the visible German roaches with spray is enough to eliminate the infestation.", options: TF, correctIndex: 1 },
  // Part 2 — Multiple choice
  {
    prompt: "The shield-like plate behind a roach's head, whose markings help identify the species, is called the:",
    options: ["Cerci", "Ootheca", "Pronotum", "Instar"],
    correctIndex: 2,
  },
  {
    prompt: "Which cockroach is the largest, reddish-brown, and marked with a yellowish figure-eight behind the head?",
    options: ["German cockroach", "Brown-banded cockroach", "American cockroach", "Oriental cockroach"],
    correctIndex: 2,
  },
  {
    prompt: "A technician finds small tan roaches with two dark stripes behind the refrigerator. The species is most likely:",
    options: ["Oriental cockroach", "German cockroach", "American cockroach", "Brown-banded cockroach"],
    correctIndex: 1,
  },
  {
    prompt: "Which species is shiny dark brown to black, has no stripes, and prefers cool, damp places like drains?",
    options: ["German cockroach", "American cockroach", "Oriental cockroach", "Brown-banded cockroach"],
    correctIndex: 2,
  },
  {
    prompt: "Why does correct species identification matter before treating?",
    options: [
      "It is required for billing purposes only",
      "Each species has different habitat and behavior, so each needs a different treatment approach",
      "All roaches respond identically to the same treatment",
      "It only matters for commercial accounts",
    ],
    correctIndex: 1,
  },
  {
    prompt: "Small black specks resembling ground pepper or coffee grounds in a cabinet corner are most likely:",
    options: ["Shed skins", "Egg cases", "Droppings from small roaches", "Smear marks"],
    correctIndex: 2,
  },
  {
    prompt: "Which behavior best explains why roach activity concentrates in shared harborage rather than spreading evenly?",
    options: [
      "Roaches are territorial and avoid each other",
      "Droppings release pheromones that attract other roaches",
      "Roaches only live where there is no food",
      "Roaches are active only in daylight",
    ],
    correctIndex: 1,
  },
  {
    prompt: "A customer reports roaches high in the upper cabinets and behind picture frames, in dry rooms. Which species and approach fit best?",
    options: [
      "Oriental cockroach — treat the drains",
      "American cockroach — treat the perimeter",
      "Brown-banded cockroach — whole-room approach with treatment placed high",
      "German cockroach — bait under the sink only",
    ],
    correctIndex: 2,
  },
  {
    prompt: "A customer asks whether having roaches means their house is dirty. The best response is:",
    options: [
      "Yes — roaches only appear in dirty homes",
      "No — roaches are common opportunists; sanitation helps control them but isn't the only cause",
      "It doesn't matter, just treat and leave",
      "Only if they saw the roaches in the kitchen",
    ],
    correctIndex: 1,
  },
  {
    prompt: "A technician finds a German cockroach infestation plus a drip under the sink. The most complete response is:",
    options: [
      "Spray all visible roaches and leave",
      "Bait the harborage, recommend fixing the drip and improving sanitation, and schedule follow-up",
      "Apply spray over the bait to work faster",
      "Treat only the countertops where the customer saw roaches",
    ],
    correctIndex: 1,
  },
];

function readBody(): string {
  return readFileSync(join(process.cwd(), "prisma", "data", BODY_FILE), "utf8");
}

export async function seedTrainingGhp(prisma: PrismaClient) {
  const body = readBody();
  const questions = JSON.stringify(QUESTIONS);

  const existing = await prisma.course.findFirst({ where: { title: COURSE_TITLE } });
  const course = existing
    ? await prisma.course.update({
        where: { id: existing.id },
        data: { category: "ceu", description: body, questions, passingScore: PASSING_SCORE, active: true },
      })
    : await prisma.course.create({
        data: { title: COURSE_TITLE, category: "ceu", description: body, questions, passingScore: PASSING_SCORE, active: true },
      });

  // Assign to every active technician who doesn't already have this course.
  const techs = await prisma.employee.findMany({
    where: { status: "active", role: { contains: "Technician" } },
    select: { id: true, branch: true },
  });
  let assigned = 0;
  for (const t of techs) {
    const has = await prisma.trainingAssignment.findFirst({ where: { courseId: course.id, employeeId: t.id } });
    if (has) continue;
    await prisma.trainingAssignment.create({
      data: { courseId: course.id, employeeId: t.id, branch: t.branch, dueDate: DUE, notifiedAt: new Date() },
    });
    assigned++;
  }

  return { created: existing ? 0 : 1, refreshed: existing ? 1 : 0, questions: QUESTIONS.length, bodyChars: body.length, technicians: techs.length, assigned };
}

// Standalone sanity run: `tsx prisma/seed-training-ghp.ts`
if (process.argv[1] && process.argv[1].includes("seed-training-ghp")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await seedTrainingGhp(prisma);
      console.log("seed-training-ghp:", JSON.stringify(r));
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
