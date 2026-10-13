import { PrismaClient } from "@prisma/client";

/**
 * Internal Certification Program — reference-data seed (SHELL ONLY).
 *
 * Seeds the content-free reference data for the certification program:
 *   - 10 Certifications (CW, FC, PC, LAWN, TERM, RX, MOS, WL, CSR, SLS)
 *   - 87 CertModules (every module code in the spec; WL has NONE)
 *   - 16 CertPrerequisite edges
 *   - 6 CertPathways (+ their fixed required certs)
 *
 * Idempotent: everything upserts by its stable key (`code` / `key` / unique
 * join), so it is safe to run on every deploy. Writes NO employee data — the
 * enrollment / progress / field-hour / award tables stay empty. Adds NO training
 * content and NO enforcement logic.
 */

// ----- Certifications -------------------------------------------------------
// order: CW..SLS = 1..10. isServiceCert = PC/LAWN/TERM/RX/MOS/WL.
// requiresAllServiceCerts = SLS. fieldHoursRequired + passScore stay null
// (open decisions in the spec).
type CertSeed = {
  code: string;
  name: string;
  audience: string;
  order: number;
  isServiceCert?: boolean;
  requiresAllServiceCerts?: boolean;
  fieldHoursNote?: string;
  signOffRoles?: string;
  externalRequirement?: string;
};

const CERTIFICATIONS: CertSeed[] = [
  {
    code: "CW",
    name: "The Clements Way",
    audience: "Every employee",
    order: 1,
    signOffRoles: "trainer or supervisor",
  },
  {
    code: "FC",
    name: "Field Core",
    audience: "All field roles and Sales",
    order: 2,
    signOffRoles: "trainer or supervisor",
  },
  {
    code: "PC",
    name: "General Household Pest",
    audience: "PC technicians, Sales, Management",
    order: 3,
    isServiceCert: true,
    fieldHoursNote: "40 hours / 5 days minimum (FDACS)",
    signOffRoles: "trainer or supervisor",
  },
  {
    code: "LAWN",
    name: "Lawn & Ornamental",
    audience: "Lawn technicians, Sales, Management",
    order: 4,
    isServiceCert: true,
    fieldHoursNote: "40 hours / 5 days minimum (FDACS)",
    signOffRoles: "trainer or supervisor",
  },
  {
    code: "TERM",
    name: "Termite & WDO",
    audience: "Termite technicians, Sales, Management",
    order: 5,
    isServiceCert: true,
    signOffRoles: "trainer or supervisor",
  },
  {
    code: "RX",
    name: "Rodent Exclusion (Rodent Shield)",
    audience: "Rodent Shield technicians, Sales, Management",
    order: 6,
    isServiceCert: true,
    fieldHoursNote: "4–5 hrs self-study + 20–30 field hours",
    signOffRoles: "trainer or supervisor",
  },
  {
    code: "MOS",
    name: "Mosquito Misting",
    audience: "Misting technicians, Sales, Management",
    order: 7,
    isServiceCert: true,
    signOffRoles: "trainer or supervisor",
  },
  {
    code: "WL",
    name: "Wildlife",
    audience: "Wildlife technicians, Sales, Management",
    order: 8,
    isServiceCert: true,
    signOffRoles: "trainer or supervisor",
  },
  {
    code: "CSR",
    name: "Customer Service",
    audience: "CSRs, Management",
    order: 9,
    fieldHoursNote: "live-call shadowing + 3-hr GHP ride-along + 2-hr live-call eval",
    signOffRoles: "trainer or supervisor",
  },
  {
    code: "SLS",
    name: "Sales",
    audience: "Sales (Service Advisors), Management",
    order: 10,
    requiresAllServiceCerts: true,
    signOffRoles: "Service Advisor, Regional Manager, Director of Sales; copy to HR",
    externalRequirement:
      "Sales inspectors may not walk roofs; FDACS inspector ID must be current",
  },
];

// ----- Modules --------------------------------------------------------------
// Every module code in the spec, with exact name + contentStatus + sourceNote
// for the parenthetical notes. WL has NO modules (certification record only).
type ModSeed = {
  code: string;
  name: string;
  status: "exists" | "partial" | "none";
  note?: string;
};

const MODULES: Record<string, ModSeed[]> = {
  CW: [
    { code: "CW-01", name: "Who We Are", status: "exists" },
    { code: "CW-02", name: "Standards & the Three Pillars", status: "exists", note: "needs role-neutral rewrite" },
    { code: "CW-03", name: "The Orange Ice Cube Customer Experience", status: "exists", note: "pilot built" },
    { code: "CW-04", name: "Internal Communication", status: "exists" },
    { code: "CW-05", name: "What We Sell", status: "exists" },
    { code: "CW-06", name: "Company Policies", status: "exists" },
    { code: "CW-07", name: "Appearance & Dress Code", status: "exists" },
    { code: "CW-08", name: "Payroll, Benefits & Paychex", status: "exists" },
    { code: "CW-09", name: "Safety Basics & Accident Reporting", status: "exists" },
    { code: "CW-10", name: "Our Systems (PestPac, email, Google Chat, Paychex)", status: "none" },
  ],
  FC: [
    { code: "FC-01", name: "Pest Management & IPM", status: "exists" },
    { code: "FC-02", name: "Labels & Pesticide Law", status: "exists" },
    { code: "FC-03", name: "PPE & Respirators", status: "exists" },
    { code: "FC-04", name: "Environmental Safety", status: "exists" },
    { code: "FC-05", name: "Chemical Storage & Spill Response", status: "exists" },
    { code: "FC-06", name: "Ladder Safety", status: "exists" },
    { code: "FC-07", name: "Vehicle Standards", status: "exists" },
    { code: "FC-08", name: "Driver Safety & GPS", status: "exists" },
    { code: "FC-09", name: "Route Management", status: "exists" },
    { code: "FC-10", name: "PestPac Mobile", status: "exists" },
    { code: "FC-11", name: "The Clements Service Visit", status: "exists" },
  ],
  PC: [
    { code: "PC-01", name: "GHP Equipment", status: "exists" },
    { code: "PC-02", name: "Interior Treatment", status: "exists" },
    { code: "PC-03", name: "Exterior Three-Pass Treatment", status: "exists" },
    { code: "PC-04", name: "GHP Calibration & Mix Rates", status: "exists" },
    { code: "PC-05", name: "Initial Service Standard", status: "exists" },
    { code: "PC-06", name: "Inspection", status: "exists" },
    { code: "PC-07", name: "Pest ID: Ants, Roaches, Rodents", status: "exists" },
    { code: "PC-08", name: "Cleanouts (flea, tick, roach)", status: "exists" },
  ],
  LAWN: [
    { code: "LAWN-01", name: "L&O Equipment", status: "exists" },
    { code: "LAWN-02", name: "L&O Program & Calendar", status: "exists" },
    { code: "LAWN-03", name: "Standard L&O Visit", status: "exists" },
    { code: "LAWN-04", name: "Turfgrass Varieties", status: "exists" },
    { code: "LAWN-05", name: "Fertilizer & Blackout Rules", status: "exists" },
    { code: "LAWN-06", name: "Weeds & Herbicides", status: "exists" },
    { code: "LAWN-07", name: "Turf Pests", status: "exists" },
    { code: "LAWN-08", name: "Disease & Stress Diagnosis", status: "exists" },
    { code: "LAWN-09", name: "L&O Calibration & Mix Rates", status: "none" },
  ],
  TERM: [
    { code: "TERM-01", name: "Termite Biology & ID", status: "exists" },
    { code: "TERM-02", name: "Sentricon Install & Monitoring", status: "exists", note: "also requires Corteva Certified Sentricon Specialist" },
    { code: "TERM-03", name: "Liquid Subterranean Treatment", status: "partial", note: "V5 draft" },
    { code: "TERM-04", name: "Drywood Spot & Whole-Home Treatment", status: "partial", note: "V5 draft" },
    { code: "TERM-05", name: "New-Construction Pretreat", status: "partial", note: "V5 draft" },
    { code: "TERM-06", name: "WDO Inspections & Reporting", status: "partial", note: "requires FDACS WDO ID card; WDO policy and pricing pending" },
    { code: "TERM-07", name: "Warranty, Renewals & ATI", status: "partial", note: "V5 draft" },
  ],
  RX: [
    { code: "RX-01", name: "Rodent Biology & Behavior", status: "exists" },
    { code: "RX-02", name: "Inspection & Entry Point Assessment", status: "exists" },
    { code: "RX-03", name: "Traps & Devices", status: "exists" },
    { code: "RX-04", name: "Exclusion — Clements Standard", status: "exists" },
    { code: "RX-05", name: "Add-On Services", status: "exists" },
    { code: "RX-06", name: "Basic vs. Plus, Warranty & Customer Conversations", status: "exists" },
    { code: "RX-07", name: "Documentation & Return Visits", status: "exists" },
    { code: "RX-08", name: "Rodent Field Safety", status: "exists" },
    { code: "RX-09", name: "Limits & Escalation", status: "exists" },
    { code: "RX-10", name: "Scored Knowledge Check", status: "exists" },
    { code: "RX-11", name: "Field Training & Sign-Off", status: "exists" },
  ],
  MOS: [
    { code: "MOS-01", name: "Misting Program & Concentrates", status: "exists" },
    { code: "MOS-02", name: "Equipment: Gen 3 Tankless & Gen 1.3 Drum", status: "exists" },
    { code: "MOS-03", name: "First 5 Minutes & System Inspection", status: "exists" },
    { code: "MOS-04", name: "Refill & Reprogram", status: "exists" },
    { code: "MOS-05", name: "Error Codes & Diagnostics", status: "exists" },
    { code: "MOS-06", name: "Nozzle Replacement & Repair Approval", status: "exists" },
    { code: "MOS-07", name: "Installation", status: "exists" },
    { code: "MOS-08", name: "Warranty, Seasonal Service & Customer Communication", status: "exists" },
    { code: "MOS-09", name: "MistAway U (external)", status: "exists", note: "external" },
    { code: "MOS-10", name: "Competency Sign-Off", status: "exists" },
  ],
  WL: [], // Wildlife — certification record only, NO modules (content to be defined).
  CSR: [
    { code: "CSR-01", name: "Phone Handling", status: "exists" },
    { code: "CSR-02", name: "PestPac Office Operations", status: "exists" },
    { code: "CSR-03", name: "Scheduling & Routing Rules", status: "exists" },
    { code: "CSR-04", name: "Booking Each Service (intake questions shared with SLS-02)", status: "partial", note: "Lawn section not written" },
    { code: "CSR-05", name: "Leads & Opportunities", status: "exists" },
    { code: "CSR-06", name: "Cancellations & Saves", status: "exists" },
    { code: "CSR-07", name: "Callbacks & Reviews", status: "exists" },
    { code: "CSR-08", name: "Scripts & Policies", status: "exists" },
    { code: "CSR-09", name: "Field Ride-Along", status: "exists" },
  ],
  SLS: [
    { code: "SLS-01", name: "Role, Standards & Field Setup", status: "partial", note: "no week-by-week onboarding schedule yet" },
    { code: "SLS-02", name: "Lead Response, Intake & Appointment Setting (includes the CSR initial-call intake questions)", status: "exists" },
    { code: "SLS-03", name: "Arrival, Discovery & Whole-Property Inspection", status: "exists" },
    { code: "SLS-04", name: "Selling Termite Services", status: "exists", note: "agreements pending approval" },
    { code: "SLS-05", name: "Selling GHP, Rodent, Wildlife, Insulation, Lawn & Mosquito", status: "partial", note: "no mosquito role play; no GHP, lawn, mosquito or rodent scopes" },
    { code: "SLS-06", name: "Pricing & Proposal Building", status: "partial", note: "discount authority to confirm; Smarter Launch not live" },
    { code: "SLS-07", name: "Presenting, Agreements, Financing & Closing", status: "exists", note: "financing wording to confirm" },
    { code: "SLS-08", name: "Objection Handling", status: "exists" },
    { code: "SLS-09", name: "Contract Entry & Handoff to Service", status: "partial", note: "New Start Policy exists; no current contract-entry SOP" },
    { code: "SLS-10", name: "Prospecting & Lead Generation", status: "exists" },
    { code: "SLS-11", name: "Follow-Up, Pipeline & Referrals", status: "exists" },
    { code: "SLS-12", name: "Role-Play Certification & Observed Appointments", status: "exists" },
  ],
};

// ----- Prerequisites --------------------------------------------------------
// FC→CW; each service cert (PC,LAWN,TERM,RX,MOS,WL) → CW and → FC; CSR→CW;
// SLS→CW and →FC. (SLS's "all service certs" is the requiresAllServiceCerts
// FLAG, not prereq rows.) 16 edges total: dependent → [prerequisites].
const PREREQUISITES: Record<string, string[]> = {
  FC: ["CW"],
  PC: ["CW", "FC"],
  LAWN: ["CW", "FC"],
  TERM: ["CW", "FC"],
  RX: ["CW", "FC"],
  MOS: ["CW", "FC"],
  WL: ["CW", "FC"],
  CSR: ["CW"],
  SLS: ["CW", "FC"],
};

// ----- Pathways -------------------------------------------------------------
type PathwaySeed = {
  key: string;
  label: string;
  description?: string;
  order: number;
  fixedCerts: string[]; // cert codes required outright
  includeHiredService?: boolean;
  includeAllServiceCerts?: boolean;
  includeSLS?: boolean;
  includeCSR?: boolean;
  includeAllCerts?: boolean;
};

const PATHWAYS: PathwaySeed[] = [
  {
    key: "new_hire_field",
    label: "New hire, field",
    description: "CW + FC + the service the person was hired into (e.g. PC).",
    order: 1,
    fixedCerts: ["CW", "FC"],
    includeHiredService: true,
  },
  {
    key: "new_hire_csr",
    label: "New hire, CSR",
    description: "CW + CSR. CSR does not require Field Core.",
    order: 2,
    fixedCerts: ["CW", "CSR"],
  },
  {
    key: "new_hire_sales",
    label: "New hire, Sales",
    description: "CW + FC + every service certification + SLS.",
    order: 3,
    fixedCerts: ["CW", "FC", "SLS"],
    includeAllServiceCerts: true,
  },
  {
    key: "add_service",
    label: "Technician adding/switching a service",
    description: "That service's certification only.",
    order: 4,
    fixedCerts: [],
    includeHiredService: true,
  },
  {
    key: "into_sales",
    label: "Any role into Sales",
    description: "Every service certification + SLS (anything not already held).",
    order: 5,
    fixedCerts: ["SLS"],
    includeAllServiceCerts: true,
  },
  {
    key: "into_management",
    label: "Any role into Management",
    description: "Every certification (all service certs, CSR and SLS).",
    order: 6,
    fixedCerts: [],
    includeAllCerts: true,
  },
];

export async function seedCertifications(prisma: PrismaClient) {
  // 1) Certifications (upsert by code).
  const certIdByCode: Record<string, string> = {};
  for (const c of CERTIFICATIONS) {
    const data = {
      name: c.name,
      audience: c.audience,
      order: c.order,
      isServiceCert: c.isServiceCert ?? false,
      requiresAllServiceCerts: c.requiresAllServiceCerts ?? false,
      fieldHoursRequired: null,
      fieldHoursNote: c.fieldHoursNote ?? null,
      passScore: null,
      signOffRoles: c.signOffRoles ?? null,
      externalRequirement: c.externalRequirement ?? null,
      active: true,
      status: "active",
    };
    const row = await prisma.certification.upsert({
      where: { code: c.code },
      update: data,
      create: { code: c.code, ...data },
    });
    certIdByCode[c.code] = row.id;
  }

  // 2) Modules (upsert by code). WL has none.
  let moduleCount = 0;
  for (const [certCode, mods] of Object.entries(MODULES)) {
    const certificationId = certIdByCode[certCode];
    for (let i = 0; i < mods.length; i++) {
      const m = mods[i];
      const data = {
        name: m.name,
        certificationId,
        order: i + 1,
        contentStatus: m.status,
        sourceNote: m.note ?? null,
      };
      await prisma.certModule.upsert({
        where: { code: m.code },
        update: data,
        create: { code: m.code, ...data },
      });
      moduleCount++;
    }
  }

  // 3) Prerequisites (upsert by the composite unique).
  let prereqCount = 0;
  for (const [certCode, prereqCodes] of Object.entries(PREREQUISITES)) {
    const certificationId = certIdByCode[certCode];
    for (const prereqCode of prereqCodes) {
      const prerequisiteId = certIdByCode[prereqCode];
      await prisma.certPrerequisite.upsert({
        where: { certificationId_prerequisiteId: { certificationId, prerequisiteId } },
        update: {},
        create: { certificationId, prerequisiteId },
      });
      prereqCount++;
    }
  }

  // 4) Pathways (upsert by key) + their fixed required certs.
  for (const p of PATHWAYS) {
    const data = {
      label: p.label,
      description: p.description ?? null,
      order: p.order,
      includeHiredService: p.includeHiredService ?? false,
      includeAllServiceCerts: p.includeAllServiceCerts ?? false,
      includeSLS: p.includeSLS ?? false,
      includeCSR: p.includeCSR ?? false,
      includeAllCerts: p.includeAllCerts ?? false,
    };
    const pathway = await prisma.certPathway.upsert({
      where: { key: p.key },
      update: data,
      create: { key: p.key, ...data },
    });
    for (const certCode of p.fixedCerts) {
      const certificationId = certIdByCode[certCode];
      await prisma.certPathwayCert.upsert({
        where: { pathwayId_certificationId: { pathwayId: pathway.id, certificationId } },
        update: {},
        create: { pathwayId: pathway.id, certificationId },
      });
    }
  }

  return {
    certifications: CERTIFICATIONS.length,
    modules: moduleCount,
    prerequisites: prereqCount,
    pathways: PATHWAYS.length,
  };
}

// Allow running this seed standalone: `tsx prisma/seed-certifications.ts`.
if (process.argv[1] && process.argv[1].includes("seed-certifications")) {
  const prisma = new PrismaClient();
  seedCertifications(prisma)
    .then((r) =>
      console.log(
        `Seeded certification program (shell): ${r.certifications} certifications, ${r.modules} modules, ${r.prerequisites} prerequisites, ${r.pathways} pathways.`,
      ),
    )
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
