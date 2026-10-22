import type { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Map each hosted, interactive course page to its course CODE. At build time we
 *  scan public/courses (so a newly-dropped <code>-<slug>.html auto-links with no
 *  config); at runtime (serverless, where that folder isn't on disk) we fall back
 *  to the committed manifest prisma/data/hosted-courses.json so the on-demand
 *  reseed still links courses. Regenerate the manifest with gen-hosted-courses. */
async function hostedCoursesByCode(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    for (const f of readdirSync(join(process.cwd(), "public", "courses"))) {
      if (!f.endsWith(".html")) continue;
      const m = f.match(/^([a-z]+-(?:\d+|fld))-/i); // leading "<letters>-<digits|FLD>" = the course code
      if (m) out[m[1].toUpperCase()] = `/courses/${f}`;
    }
  } catch {
    /* folder not on disk here */
  }
  if (Object.keys(out).length === 0) {
    try {
      const manifest = (await import("./data/hosted-courses.json")).default as Record<string, string>;
      Object.assign(out, manifest);
    } catch {
      /* no manifest either */
    }
  }
  return out;
}

/** Load the catalog JSON — from disk at build time, else the bundled import at
 *  runtime (so the on-demand reseed works in the serverless function). */
async function loadCatalog(): Promise<Catalog> {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "prisma", "data", "training-catalog.json"), "utf8")) as Catalog;
  } catch {
    return (await import("./data/training-catalog.json")).default as unknown as Catalog;
  }
}

/**
 * Training Center catalog seed — Program → Module → Course.
 *
 * Reads prisma/data/training-catalog.json (generated from the owner-approved
 * Clements_Certification_Import.xlsx, validated 2026-10-13: 10 certifications,
 * 5 programs, 17 modules, 91 courses, 40 program-module links, 357 ordered
 * module-course rows).
 *
 * IDEMPOTENT: every row is upserted by its stable business key (code / join
 * pair), so this runs on every deploy with no marker and never touches the
 * per-employee tables (assignments, progress, sign-offs, awards). Replaces the
 * old content-free certification "shell" seed (seed-certifications.ts).
 *
 * The six SERVICE certs (PC/LAWN/TERM/RX/MOS/WL) are flagged isServiceCert so
 * the assignment engine can reason about service expansion / sales advancement.
 */

const SERVICE_CERT_CODES = new Set(["PC", "LAWN", "TERM", "RX", "MOS", "WL"]);

type Catalog = {
  certifications: { code: string; name: string; order: number }[];
  programs: { code: string; name: string; whenToAssign: string | null; order: number }[];
  modules: {
    code: string;
    name: string;
    certificationsEarned: string | null;
    audience: string | null;
    fieldRequirement: string | null;
    order: number;
  }[];
  courses: {
    code: string;
    name: string;
    group: string;
    courseType: string;
    contentStatus: string | null;
    sourceNote?: string | null;
    targetMinutes: string | null;
    trainingFolder: string | null;
    order: number;
  }[];
  programModules: { programCode: string; moduleCode: string; rule: string; step: number | null; situation?: string | null }[];
  moduleCourses: { moduleCode: string; sequence: number; courseCode: string }[];
  situations: { situation: string; programCode: string; moduleCode: string | null; mode: string; note?: string }[];
};

export const ASSIGNMENT_GUIDE_SETTING = "training.assignment_guide";

export async function seedTrainingCatalog(prisma: PrismaClient) {
  const cat = await loadCatalog();

  // 1. Certifications (groups)
  const certIdByCode = new Map<string, string>();
  for (const c of cat.certifications) {
    const row = await prisma.certification.upsert({
      where: { code: c.code },
      update: { name: c.name, order: c.order, isServiceCert: SERVICE_CERT_CODES.has(c.code), active: true },
      create: { code: c.code, name: c.name, order: c.order, isServiceCert: SERVICE_CERT_CODES.has(c.code) },
    });
    certIdByCode.set(c.code, row.id);
  }

  // 2. Courses (units). A hosted interactive page (public/courses/<code>-*.html)
  //    auto-links via contentUrl and marks the course content "Exists".
  const hosted = await hostedCoursesByCode();
  const courseIdByCode = new Map<string, string>();
  for (const c of cat.courses) {
    const certificationId = certIdByCode.get(c.group);
    if (!certificationId) throw new Error(`course ${c.code} references unknown group ${c.group}`);
    const contentUrl = hosted[c.code.toUpperCase()] ?? null;
    const contentStatus = contentUrl ? "Exists" : (c.contentStatus ?? "None");
    const fields = {
      name: c.name,
      certificationId,
      order: c.order,
      courseType: c.courseType,
      contentStatus,
      contentUrl,
      sourceNote: c.sourceNote ?? null,
      targetMinutes: c.targetMinutes ?? null,
      trainingFolder: c.trainingFolder ?? null,
    };
    const row = await prisma.certCourse.upsert({
      where: { code: c.code },
      update: fields,
      create: { code: c.code, ...fields },
    });
    courseIdByCode.set(c.code, row.id);
  }

  // 3. Programs
  const programIdByCode = new Map<string, string>();
  for (const p of cat.programs) {
    const row = await prisma.trainingProgram.upsert({
      where: { code: p.code },
      update: { name: p.name, whenToAssign: p.whenToAssign, order: p.order, active: true },
      create: { code: p.code, name: p.name, whenToAssign: p.whenToAssign, order: p.order },
    });
    programIdByCode.set(p.code, row.id);
  }

  // 4. Modules (preserve version: never clobber a template edit's bump)
  const moduleIdByCode = new Map<string, string>();
  for (const m of cat.modules) {
    const row = await prisma.trainingModule.upsert({
      where: { code: m.code },
      update: {
        name: m.name,
        certificationsEarned: m.certificationsEarned,
        audience: m.audience,
        fieldRequirement: m.fieldRequirement,
        order: m.order,
        active: true,
      },
      create: {
        code: m.code,
        name: m.name,
        certificationsEarned: m.certificationsEarned,
        audience: m.audience,
        fieldRequirement: m.fieldRequirement,
        order: m.order,
      },
    });
    moduleIdByCode.set(m.code, row.id);
  }

  // Concrete situation labels (New hire X → specific module) keyed by program+module.
  const situationByLink = new Map<string, string>();
  for (const sit of cat.situations ?? []) {
    if (sit.moduleCode) situationByLink.set(`${sit.programCode}|${sit.moduleCode}`, sit.situation);
  }

  // 5. Program → Module links
  let programModules = 0;
  for (const pm of cat.programModules) {
    const programId = programIdByCode.get(pm.programCode);
    const moduleId = moduleIdByCode.get(pm.moduleCode);
    if (!programId || !moduleId) throw new Error(`program-module link references unknown code ${pm.programCode}/${pm.moduleCode}`);
    const situation = situationByLink.get(`${pm.programCode}|${pm.moduleCode}`) ?? null;
    await prisma.programModule.upsert({
      where: { programId_moduleId: { programId, moduleId } },
      update: { rule: pm.rule, step: pm.step ?? null, situation },
      create: { programId, moduleId, rule: pm.rule, step: pm.step ?? null, situation },
    });
    programModules++;
  }

  // Store the full 13-row Assignment Guide (incl. generic rows) for the wizard.
  await prisma.setting.upsert({
    where: { key: ASSIGNMENT_GUIDE_SETTING },
    update: { value: JSON.stringify(cat.situations ?? []) },
    create: { key: ASSIGNMENT_GUIDE_SETTING, value: JSON.stringify(cat.situations ?? []) },
  });

  // 6. Module → Course links (ordered)
  let moduleCourses = 0;
  for (const mc of cat.moduleCourses) {
    const moduleId = moduleIdByCode.get(mc.moduleCode);
    const courseId = courseIdByCode.get(mc.courseCode);
    if (!moduleId || !courseId) throw new Error(`module-course link references unknown code ${mc.moduleCode}/${mc.courseCode}`);
    await prisma.trainingModuleCourse.upsert({
      where: { moduleId_courseId: { moduleId, courseId } },
      update: { sequence: mc.sequence },
      create: { moduleId, courseId, sequence: mc.sequence },
    });
    moduleCourses++;
  }

  return {
    certifications: cat.certifications.length,
    programs: cat.programs.length,
    modules: cat.modules.length,
    courses: cat.courses.length,
    programModules,
    moduleCourses,
  };
}

// Allow running this seed standalone: `tsx prisma/seed-training-catalog.ts`.
if (process.argv[1] && process.argv[1].includes("seed-training-catalog")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await seedTrainingCatalog(prisma);
      console.log("Training catalog seeded:", r);
    } finally {
      await prisma.$disconnect();
    }
  })();
}
