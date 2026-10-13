import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";

/**
 * Read-only data access for the internal Certification Program HR/admin console.
 *
 * This layer only READS the seeded reference data (certifications, modules,
 * prerequisites, pathways). It writes nothing and never touches the empty
 * employee-facing tables (enrollment / progress / field-hour / award). All
 * mutation, enforcement, and content authoring is explicitly out of scope.
 */

/**
 * Who may open the read-only Certifications console. Mirrors the other exec HR
 * surfaces: admins always qualify, plus the granted HR and senior-leadership
 * flags. Add people by granting a flag — no code change needed here.
 */
export function canViewCertifications(user: SessionUser): boolean {
  return user.role === "admin" || user.hrAccess || user.seniorLeadership;
}

/** The six service certifications (expanded by the "all service certs" rule). */
export const SERVICE_CERT_CODES = ["PC", "LAWN", "TERM", "RX", "MOS", "WL"] as const;

export type ContentStatus = "exists" | "partial" | "none";

export type ModuleStatusCounts = {
  exists: number;
  partial: number;
  none: number;
  total: number;
};

function countStatuses(mods: { contentStatus: string }[]): ModuleStatusCounts {
  const counts: ModuleStatusCounts = { exists: 0, partial: 0, none: 0, total: mods.length };
  for (const m of mods) {
    if (m.contentStatus === "exists") counts.exists++;
    else if (m.contentStatus === "partial") counts.partial++;
    else if (m.contentStatus === "none") counts.none++;
  }
  return counts;
}

export type CertListItem = {
  code: string;
  name: string;
  audience: string;
  order: number;
  isServiceCert: boolean;
  requiresAllServiceCerts: boolean;
  fieldHoursNote: string | null;
  passScore: number | null;
  moduleCount: number;
  statusCounts: ModuleStatusCounts;
  prereqCodes: string[];
};

/** The 10 certifications ordered by `order`, with module counts + prereq codes. */
export async function listCertifications(): Promise<CertListItem[]> {
  const certs = await prisma.certification.findMany({
    orderBy: { order: "asc" },
    include: {
      modules: { select: { contentStatus: true } },
      prerequisites: {
        include: { prerequisite: { select: { code: true, order: true } } },
      },
    },
  });
  return certs.map((c) => ({
    code: c.code,
    name: c.name,
    audience: c.audience,
    order: c.order,
    isServiceCert: c.isServiceCert,
    requiresAllServiceCerts: c.requiresAllServiceCerts,
    fieldHoursNote: c.fieldHoursNote,
    passScore: c.passScore,
    moduleCount: c.modules.length,
    statusCounts: countStatuses(c.modules),
    prereqCodes: c.prerequisites
      .map((p) => p.prerequisite)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.code),
  }));
}

export type ProgramSummary = {
  certifications: number;
  modules: number;
  exists: number;
  partial: number;
  none: number;
};

/** Program-wide roll-up for the index header strip. */
export async function programSummary(): Promise<ProgramSummary> {
  const certs = await listCertifications();
  return certs.reduce<ProgramSummary>(
    (acc, c) => {
      acc.modules += c.statusCounts.total;
      acc.exists += c.statusCounts.exists;
      acc.partial += c.statusCounts.partial;
      acc.none += c.statusCounts.none;
      return acc;
    },
    { certifications: certs.length, modules: 0, exists: 0, partial: 0, none: 0 },
  );
}

export type CertModuleView = {
  order: number;
  code: string;
  name: string;
  contentStatus: string;
  sourceNote: string | null;
};

export type PathwayInclusion = {
  key: string;
  label: string;
  /** How the pathway pulls in this cert: a fixed required cert or a rule-flag expansion. */
  via: "fixed" | "all-service-certs" | "all-certs" | "sls" | "csr";
};

export type CertDetail = {
  code: string;
  name: string;
  audience: string;
  order: number;
  isServiceCert: boolean;
  requiresAllServiceCerts: boolean;
  fieldHoursNote: string | null;
  passScore: number | null;
  signOffRoles: string | null;
  externalRequirement: string | null;
  status: string;
  active: boolean;
  modules: CertModuleView[];
  statusCounts: ModuleStatusCounts;
  prerequisites: { code: string; name: string }[];
  requiredByCerts: { code: string; name: string }[];
  requiredByPathways: PathwayInclusion[];
};

/** Full detail for one certification, looked up by `code` (case-insensitive). */
export async function getCertificationByCode(code: string): Promise<CertDetail | null> {
  const cert = await prisma.certification.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      modules: { orderBy: { order: "asc" } },
      prerequisites: {
        include: { prerequisite: { select: { code: true, name: true, order: true } } },
      },
      prerequisiteFor: {
        include: { certification: { select: { code: true, name: true, order: true } } },
      },
    },
  });
  if (!cert) return null;

  const pathways = await prisma.certPathway.findMany({
    orderBy: { order: "asc" },
    include: { certs: { include: { certification: { select: { code: true } } } } },
  });
  const requiredByPathways: PathwayInclusion[] = [];
  for (const p of pathways) {
    const fixed = p.certs.some((c) => c.certification.code === cert.code);
    if (fixed) {
      requiredByPathways.push({ key: p.key, label: p.label, via: "fixed" });
    } else if (p.includeAllCerts) {
      requiredByPathways.push({ key: p.key, label: p.label, via: "all-certs" });
    } else if (cert.isServiceCert && p.includeAllServiceCerts) {
      requiredByPathways.push({ key: p.key, label: p.label, via: "all-service-certs" });
    } else if (cert.code === "SLS" && p.includeSLS) {
      requiredByPathways.push({ key: p.key, label: p.label, via: "sls" });
    } else if (cert.code === "CSR" && p.includeCSR) {
      requiredByPathways.push({ key: p.key, label: p.label, via: "csr" });
    }
  }

  return {
    code: cert.code,
    name: cert.name,
    audience: cert.audience,
    order: cert.order,
    isServiceCert: cert.isServiceCert,
    requiresAllServiceCerts: cert.requiresAllServiceCerts,
    fieldHoursNote: cert.fieldHoursNote,
    passScore: cert.passScore,
    signOffRoles: cert.signOffRoles,
    externalRequirement: cert.externalRequirement,
    status: cert.status,
    active: cert.active,
    modules: cert.modules.map((m) => ({
      order: m.order,
      code: m.code,
      name: m.name,
      contentStatus: m.contentStatus,
      sourceNote: m.sourceNote,
    })),
    statusCounts: countStatuses(cert.modules),
    prerequisites: cert.prerequisites
      .map((p) => p.prerequisite)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ code: p.code, name: p.name })),
    requiredByCerts: cert.prerequisiteFor
      .map((p) => p.certification)
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ code: c.code, name: c.name })),
    requiredByPathways,
  };
}

export type PathwayView = {
  key: string;
  label: string;
  description: string | null;
  order: number;
  fixedCerts: { code: string; name: string }[];
  includeHiredService: boolean;
  includeAllServiceCerts: boolean;
  includeSLS: boolean;
  includeCSR: boolean;
  includeAllCerts: boolean;
};

/** The 6 career pathways ordered by `order`, with their fixed certs + rule flags. */
export async function listPathways(): Promise<PathwayView[]> {
  const pathways = await prisma.certPathway.findMany({
    orderBy: { order: "asc" },
    include: {
      certs: {
        include: { certification: { select: { code: true, name: true, order: true } } },
      },
    },
  });
  return pathways.map((p) => ({
    key: p.key,
    label: p.label,
    description: p.description,
    order: p.order,
    fixedCerts: p.certs
      .map((c) => c.certification)
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ code: c.code, name: c.name })),
    includeHiredService: p.includeHiredService,
    includeAllServiceCerts: p.includeAllServiceCerts,
    includeSLS: p.includeSLS,
    includeCSR: p.includeCSR,
    includeAllCerts: p.includeAllCerts,
  }));
}
