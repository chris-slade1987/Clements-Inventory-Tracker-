import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";

/**
 * Read-only data access for the Training Center's Certifications tab (the catalog
 * view). Reads the seeded Program → Module → Course reference data. Mutation,
 * assignment, and content authoring live elsewhere (lib/training-assign.ts +
 * the API routes).
 */

/** Who may open the Certifications / Training-Center admin surfaces. */
export function canViewCertifications(user: SessionUser): boolean {
  return user.role === "admin" || user.hrAccess || user.seniorLeadership;
}

/** The six service certifications. */
export const SERVICE_CERT_CODES = ["PC", "LAWN", "TERM", "RX", "MOS", "WL"] as const;

export type ModuleStatusCounts = { exists: number; partial: number; none: number; total: number };

/** Classify the free-text content status from the import into a bucket. */
export function statusBucket(s: string | null | undefined): "exists" | "partial" | "none" {
  const v = (s ?? "").trim().toLowerCase();
  if (v.startsWith("partial")) return "partial";
  if (v === "" || v === "none") return "none";
  return "exists"; // "Exists", "Exists (…)", "Built (pilot)", …
}

function countStatuses(items: { contentStatus: string | null }[]): ModuleStatusCounts {
  const counts: ModuleStatusCounts = { exists: 0, partial: 0, none: 0, total: items.length };
  for (const m of items) counts[statusBucket(m.contentStatus)]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Certifications (groups)
// ---------------------------------------------------------------------------

export type CertListItem = {
  code: string;
  name: string;
  order: number;
  isServiceCert: boolean;
  courseCount: number;
  statusCounts: ModuleStatusCounts;
};

export async function listCertifications(): Promise<CertListItem[]> {
  const certs = await prisma.certification.findMany({
    orderBy: { order: "asc" },
    include: { courses: { select: { contentStatus: true } } },
  });
  return certs.map((c) => ({
    code: c.code,
    name: c.name,
    order: c.order,
    isServiceCert: c.isServiceCert,
    courseCount: c.courses.length,
    statusCounts: countStatuses(c.courses),
  }));
}

export type ProgramSummary = {
  certifications: number;
  programs: number;
  modules: number;
  courses: number;
  exists: number;
  partial: number;
  none: number;
};

/** Program-wide roll-up for the index header strip. */
export async function programSummary(): Promise<ProgramSummary> {
  const [certs, programs, modules, courses] = await Promise.all([
    listCertifications(),
    prisma.trainingProgram.count(),
    prisma.trainingModule.count(),
    prisma.certCourse.findMany({ select: { contentStatus: true } }),
  ]);
  const sc = countStatuses(courses);
  return {
    certifications: certs.length,
    programs,
    modules,
    courses: courses.length,
    exists: sc.exists,
    partial: sc.partial,
    none: sc.none,
  };
}

export type CertCourseView = {
  order: number;
  code: string;
  name: string;
  courseType: string;
  contentStatus: string;
  targetMinutes: string | null;
  sourceNote: string | null;
};

export type CertDetail = {
  code: string;
  name: string;
  order: number;
  isServiceCert: boolean;
  courses: CertCourseView[];
  statusCounts: ModuleStatusCounts;
  /** Modules that include at least one course from this certification group. */
  inModules: { code: string; name: string }[];
};

export async function getCertificationByCode(code: string): Promise<CertDetail | null> {
  const cert = await prisma.certification.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      courses: {
        orderBy: { order: "asc" },
        include: { moduleLinks: { include: { module: { select: { code: true, name: true } } } } },
      },
    },
  });
  if (!cert) return null;

  const moduleMap = new Map<string, { code: string; name: string }>();
  for (const c of cert.courses)
    for (const l of c.moduleLinks) moduleMap.set(l.module.code, { code: l.module.code, name: l.module.name });

  return {
    code: cert.code,
    name: cert.name,
    order: cert.order,
    isServiceCert: cert.isServiceCert,
    courses: cert.courses.map((m) => ({
      order: m.order,
      code: m.code,
      name: m.name,
      courseType: m.courseType,
      contentStatus: m.contentStatus,
      targetMinutes: m.targetMinutes,
      sourceNote: m.sourceNote,
    })),
    statusCounts: countStatuses(cert.courses),
    inModules: [...moduleMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
  };
}

// ---------------------------------------------------------------------------
// Programs & Modules (the Program → Module → Course catalog)
// ---------------------------------------------------------------------------

export type ProgramView = {
  code: string;
  name: string;
  whenToAssign: string | null;
  order: number;
  modules: { code: string; name: string; rule: string; step: number | null; situation: string | null }[];
};

export async function listPrograms(): Promise<ProgramView[]> {
  const programs = await prisma.trainingProgram.findMany({
    orderBy: { order: "asc" },
    include: {
      modules: { include: { module: { select: { code: true, name: true } } }, orderBy: [{ step: "asc" }] },
    },
  });
  return programs.map((p) => ({
    code: p.code,
    name: p.name,
    whenToAssign: p.whenToAssign,
    order: p.order,
    modules: p.modules.map((pm) => ({
      code: pm.module.code,
      name: pm.module.name,
      rule: pm.rule,
      step: pm.step,
      situation: pm.situation,
    })),
  }));
}

export type ModuleListItem = {
  code: string;
  name: string;
  certificationsEarned: string | null;
  audience: string | null;
  fieldRequirement: string | null;
  version: number;
  courseCount: number;
};

export async function listModules(): Promise<ModuleListItem[]> {
  const modules = await prisma.trainingModule.findMany({
    orderBy: { order: "asc" },
    include: { _count: { select: { courses: true } } },
  });
  return modules.map((m) => ({
    code: m.code,
    name: m.name,
    certificationsEarned: m.certificationsEarned,
    audience: m.audience,
    fieldRequirement: m.fieldRequirement,
    version: m.version,
    courseCount: m._count.courses,
  }));
}

export type ModuleDetail = ModuleListItem & {
  courses: { sequence: number; code: string; name: string; group: string; courseType: string; contentStatus: string }[];
  programs: { code: string; name: string }[];
};

export async function getModuleByCode(code: string): Promise<ModuleDetail | null> {
  const mod = await prisma.trainingModule.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      courses: { orderBy: { sequence: "asc" }, include: { course: { include: { certification: true } } } },
      programs: { include: { program: { select: { code: true, name: true } } } },
      _count: { select: { courses: true } },
    },
  });
  if (!mod) return null;
  return {
    code: mod.code,
    name: mod.name,
    certificationsEarned: mod.certificationsEarned,
    audience: mod.audience,
    fieldRequirement: mod.fieldRequirement,
    version: mod.version,
    courseCount: mod._count.courses,
    courses: mod.courses.map((l) => ({
      sequence: l.sequence,
      code: l.course.code,
      name: l.course.name,
      group: l.course.certification.code,
      courseType: l.course.courseType,
      contentStatus: l.course.contentStatus,
    })),
    programs: mod.programs.map((pm) => ({ code: pm.program.code, name: pm.program.name })),
  };
}

export type Situation = {
  situation: string;
  programCode: string;
  moduleCode: string | null;
  /** "module" (concrete) | "pick_module" | "pick_service" | "service_with_fc" | "program_steps" */
  mode: string;
  note?: string;
};

/** The full 13-row Assignment-Guide situation list (for the assign wizard). */
export async function listAssignmentGuide(): Promise<Situation[]> {
  const s = await prisma.setting.findUnique({ where: { key: "training.assignment_guide" } }).catch(() => null);
  if (!s) return [];
  try {
    return JSON.parse(s.value) as Situation[];
  } catch {
    return [];
  }
}
