/**
 * Training Center — the 8 build checks from the Assignment Build Spec, run as an
 * automated acceptance test against a scratch SQLite DB.
 *
 *   DATABASE_URL="file:/tmp/test.db" npx tsx scripts/test-training-assign.ts
 *
 * Exits non-zero if ANY check fails. Each check uses a fresh employee.
 */
import { PrismaClient } from "@prisma/client";
import { seedTrainingCatalog } from "../prisma/seed-training-catalog";
import {
  previewAssignment,
  confirmAssignment,
  assignNextAdvancementStep,
  completeCourse,
  approveFieldSignoff,
} from "../lib/training-assign";

const prisma = new PrismaClient();
let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.log(`  ❌ ${name}${detail ? "  — " + detail : ""}`);
  }
}

async function newEmployee(name: string): Promise<string> {
  const e = await prisma.employee.create({ data: { name, branch: "Vero Beach (HQ)" } });
  return e.id;
}

/** Set prior history: mark every course of the given modules complete (direct). */
async function completeModules(employeeId: string, moduleCodes: string[]) {
  for (const code of moduleCodes) {
    const mod = await prisma.trainingModule.findUnique({ where: { code } });
    if (!mod) throw new Error(`no module ${code}`);
    const links = await prisma.trainingModuleCourse.findMany({ where: { moduleId: mod.id } });
    for (const l of links) {
      await prisma.courseProgress.upsert({
        where: { employeeId_courseId: { employeeId, courseId: l.courseId } },
        update: { status: "complete", completedDate: new Date("2026-01-15") },
        create: { employeeId, courseId: l.courseId, status: "complete", completedDate: new Date("2026-01-15") },
      });
    }
  }
}

async function main() {
  await seedTrainingCatalog(prisma);
  const NOW = new Date("2026-10-13T12:00:00");

  // 1. New GHP hire assigned ONB-GHP receives 30 courses in order.
  {
    const emp = await newEmployee("Check1 GHP Hire");
    const p = await previewAssignment(prisma, { employeeId: emp, programCode: "PRG-ONB", moduleCode: "ONB-GHP", now: NOW });
    const expected = [
      ...Array.from({ length: 10 }, (_, i) => `CW-${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 11 }, (_, i) => `FC-${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 8 }, (_, i) => `PC-${String(i + 1).padStart(2, "0")}`),
      "PC-FLD",
    ];
    const got = p.courses.map((c) => c.code);
    check("1. ONB-GHP = 30 courses", p.courses.length === 30, `got ${p.courses.length}`);
    check("1. in correct order", JSON.stringify(got) === JSON.stringify(expected));
    check("1. all newly assigned", p.toComplete.length === 30 && p.credited.length === 0);
  }

  // 2. Lawn tech with CW+FC complete → ONB-GHP gives only 9 PC; 21 credited.
  {
    const emp = await newEmployee("Check2 Lawn CWFC");
    await completeModules(emp, ["SVC-FC"]); // FC-01..FC-11
    // complete CW-01..CW-10 too (CW has no standalone module; do directly)
    const cw = await prisma.certCourse.findMany({ where: { certification: { code: "CW" } } });
    for (const c of cw)
      await prisma.courseProgress.create({ data: { employeeId: emp, courseId: c.id, status: "complete", completedDate: new Date("2026-02-01") } });
    const p = await previewAssignment(prisma, { employeeId: emp, moduleCode: "ONB-GHP", now: NOW });
    check("2. only 9 PC to complete", p.toComplete.length === 9 && p.toComplete.every((c) => c.group === "PC"), `got ${p.toComplete.length}`);
    check("2. 21 credited", p.credited.length === 21, `got ${p.credited.length}`);
  }

  // 3. Lawn tech assigned SVC-PC → only the 9 PC courses (has FC, no guard).
  {
    const emp = await newEmployee("Check3 Lawn");
    await completeModules(emp, ["ONB-LAWN"]); // CW+FC+LAWN
    const p = await previewAssignment(prisma, { employeeId: emp, moduleCode: "SVC-PC", now: NOW });
    check("3. SVC-PC = 9 courses, no prereq", p.courses.length === 9 && p.prereqAdded.length === 0, `got ${p.courses.length}, prereq ${p.prereqAdded.length}`);
    check("3. all PC, all to-complete", p.toComplete.length === 9 && p.toComplete.every((c) => c.group === "PC"));
  }

  // 4. CSR assigned SVC-PC → 11 FC courses first, with a notice.
  {
    const emp = await newEmployee("Check4 CSR");
    await completeModules(emp, ["ONB-CSR"]); // CW + CSR, NO FC
    const p = await previewAssignment(prisma, { employeeId: emp, moduleCode: "SVC-PC", now: NOW });
    const first11 = p.courses.slice(0, 11);
    check("4. 11 FC prereq added", p.prereqAdded.length === 11, `got ${p.prereqAdded.length}`);
    check("4. FC courses come first", first11.every((c) => c.group === "FC"));
    check("4. notice present", !!p.prereqNote);
    check("4. total 20 (11 FC + 9 PC)", p.courses.length === 20, `got ${p.courses.length}`);
  }

  // 5. A single course assigned appears and does NOT block the next module.
  {
    const emp = await newEmployee("Check5 Standalone");
    await confirmAssignment(prisma, { employeeId: emp, standaloneCourseCode: "CW-03", now: NOW });
    const prog = await prisma.courseProgress.findFirst({ where: { employeeId: emp, course: { code: "CW-03" } } });
    check("5. standalone course on list", !!prog && prog.status === "assigned");
    const p = await previewAssignment(prisma, { employeeId: emp, moduleCode: "ONB-GHP", now: NOW });
    check("5. module not pacing-blocked by standalone", p.pacing.blockedThisMonth === false);
  }

  // 6. Sales Advancement for a lawn tech skips SVC-LAWN and starts at SVC-PC.
  {
    const emp = await newEmployee("Check6 Lawn SLS");
    await completeModules(emp, ["ONB-LAWN"]); // CW+FC+LAWN complete
    const r1 = await assignNextAdvancementStep(prisma, { employeeId: emp, programCode: "PRG-SLS", now: NOW, overridePacing: true });
    check("6. first advancement step = SVC-PC", r1.assignedModuleCode === "SVC-PC", `got ${r1.assignedModuleCode}`);
    check("6. SVC-FC skipped (already complete)", r1.skipped.includes("SVC-FC"));
    // complete SVC-PC, advance again → SVC-LAWN is complete so it must be skipped
    await completeModules(emp, ["SVC-PC"]);
    const r2 = await assignNextAdvancementStep(prisma, { employeeId: emp, programCode: "PRG-SLS", now: NOW, overridePacing: true });
    check("6. SVC-LAWN skipped (already complete)", r2.skipped.includes("SVC-LAWN"), `skipped ${r2.skipped.join(",")}`);
    check("6. advances to SVC-TERM", r2.assignedModuleCode === "SVC-TERM", `got ${r2.assignedModuleCode}`);
  }

  // 7. An employee cannot start a second module in the same calendar month.
  {
    const emp = await newEmployee("Check7 Pacing");
    await confirmAssignment(prisma, { employeeId: emp, moduleCode: "ONB-GHP", now: NOW });
    const p = await previewAssignment(prisma, { employeeId: emp, moduleCode: "SVC-RX", now: NOW });
    check("7. second module blocked this month", p.pacing.blockedThisMonth === true);
    let threw = false;
    try {
      await confirmAssignment(prisma, { employeeId: emp, moduleCode: "SVC-RX", now: NOW });
    } catch {
      threw = true;
    }
    check("7. confirm throws without override", threw);
  }

  // 8. A certification is not awarded until its field sign-off course is approved.
  {
    const emp = await newEmployee("Check8 Award Gate");
    await confirmAssignment(prisma, { employeeId: emp, moduleCode: "ONB-GHP", now: NOW });
    // complete all 30 courses via the real completion path (incl PC-FLD)
    const codes = [
      ...Array.from({ length: 10 }, (_, i) => `CW-${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 11 }, (_, i) => `FC-${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 8 }, (_, i) => `PC-${String(i + 1).padStart(2, "0")}`),
      "PC-FLD",
    ];
    for (const code of codes) await completeCourse(prisma, { employeeId: emp, courseCode: code });
    const pcCert = await prisma.certification.findUnique({ where: { code: "PC" } });
    let award = await prisma.certAward.findFirst({ where: { employeeId: emp, certificationId: pcCert!.id } });
    check("8. PC NOT awarded before sign-off approved", !award);
    // CW + FC (no field sign-off) SHOULD be awarded already
    const cw = await prisma.certification.findUnique({ where: { code: "CW" } });
    const cwAward = await prisma.certAward.findFirst({ where: { employeeId: emp, certificationId: cw!.id } });
    check("8. CW awarded (no field sign-off in group)", !!cwAward);
    // create + approve the PC-FLD field sign-off
    const fld = await prisma.certCourse.findUnique({ where: { code: "PC-FLD" } });
    const so = await prisma.fieldSignoff.create({
      data: { employeeId: emp, courseId: fld!.id, certificationId: pcCert!.id, date: new Date("2026-10-20"), hours: 40, trainerName: "Trainer" },
    });
    await approveFieldSignoff(prisma, { signoffId: so.id, approvedByName: "Supervisor" });
    award = await prisma.certAward.findFirst({ where: { employeeId: emp, certificationId: pcCert!.id } });
    check("8. PC awarded after sign-off approved", !!award);
  }

  console.log(failures === 0 ? "\nALL 8 BUILD CHECKS PASSED ✅" : `\n${failures} CHECK(S) FAILED ❌`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
