import { prisma } from "@/lib/prisma";
import { scoreAudit, fieldOpsEmployee, type Facility, type YesNo, type Ratings5 } from "@/lib/audit";
import { listEmployees, matchEmployeeByName } from "@/lib/people";

// Idempotent, add-only healer that loads the Q4 2026 Orlando branch audit that
// Graham Foster filled out on paper (visit 10/21/2026) as an editable DRAFT, so
// he can open it, sign, and route it to the branch manager. Skips once any
// Orlando Q4 2026 audit exists so it never clobbers live edits. NON-FATAL.

const BRANCH = "orlando";
const YEAR = 2026;
const QUARTER = 4;

const RIDES = [
  {
    technicianName: "Olivia", serviceType: "general_pest",
    customerInteraction: 5, serviceExecution: 5, equipmentPrep: 5, safety: 5,
    safetyNotes: "Olivia is very detailed in going about her job. I observed her taking quality notes on apartments.",
    strengths: "Personable & warm to tenants.",
    improvement: null as string | null,
    coaching: "We need to set a standard of service for Multi-Family and then show each tech how to meet that standard.",
  },
  {
    technicianName: "Ted", serviceType: "general_pest",
    customerInteraction: null as number | null, serviceExecution: 5, equipmentPrep: 5, safety: 5,
    safetyNotes: null as string | null,
    strengths: "Ted is a workhorse and solves problems well.",
    improvement: "Ted needs to pay attention to the details better — read emails and understand how to do what we are asking.",
    coaching: "We need to set the standard for Multi-Family and coach Ted up to that standard.",
  },
  {
    technicianName: "Sarah", serviceType: "termite",
    customerInteraction: 5, serviceExecution: 5, equipmentPrep: 5, safety: 5,
    safetyNotes: null as string | null,
    strengths: "Sarah is knowledgeable and cares about her work.",
    improvement: null as string | null,
    coaching: null as string | null,
  },
];

export async function ensureOrlandoQ4AuditDraft() {
  try {
    const existing = await prisma.branchAudit.findUnique({
      where: { branch_year_quarter: { branch: BRANCH, year: YEAR, quarter: QUARTER } },
      select: { id: true },
    });
    if (existing) return { skipped: true as const };

    // Facility A+B all "Excellent" (3); C all "Yes". Personnel all "Yes".
    const facility: Facility = {
      ppe: 3, vehicles_stocked: 3, chemical_storage: 3, extinguishers_firstaid: 3, no_hazards: 3,
      office: 3, licenses_displayed: 3, osha_posters: 3, breakroom_restrooms: 3, warehouse_storage: 3,
      handheld_working: true, vehicles_clean: true, vehicle_inspections: true, spill_kits: true,
      accident_forms: true, insurance_cards: true, tools_stored: true, backup_supplies: true,
    };
    const personnel: YesNo = {
      ceu_current: true, training_access: true, uniforms_ids: true, meetings: true, complaint_process: true, reviews_scheduled: true,
    };
    const ratings: Ratings5 = { equipment: 5, personnel: 5 };
    const { score, maxScore, scorePct } = scoreAudit(facility, personnel, ratings);

    const auditor = await fieldOpsEmployee();
    const emps = (await listEmployees(BRANCH)).map((e) => ({ id: e.id, name: e.name, role: e.role, division: e.division, branch: e.branch }));

    const audit = await prisma.branchAudit.create({
      data: {
        branch: BRANCH, year: YEAR, quarter: QUARTER,
        visitDate: new Date("2026-10-21T00:00:00Z"),
        auditorName: "Graham Foster",
        auditorEmployeeId: auditor?.id ?? null,
        status: "draft",
        facility: JSON.stringify(facility),
        personnel: JSON.stringify(personnel),
        ratings: JSON.stringify(ratings),
        concerns: "In my opinion Orlando has enough staff; however, Steve is a wild card and doesn't perform as we need him to.",
        suggestions: null,
        nextQuarterPlan: null,
        score, maxScore, scorePct,
      },
    });

    for (const r of RIDES) {
      await prisma.auditRideAlong.create({
        data: {
          auditId: audit.id,
          employeeId: matchEmployeeByName(r.technicianName, emps),
          technicianName: r.technicianName,
          serviceType: r.serviceType,
          customerInteraction: r.customerInteraction,
          serviceExecution: r.serviceExecution,
          equipmentPrep: r.equipmentPrep,
          safety: r.safety,
          safetyNotes: r.safetyNotes,
          strengths: r.strengths,
          improvement: r.improvement,
          coaching: r.coaching,
        },
      });
    }

    await prisma.auditFollowUp.create({
      data: {
        auditId: audit.id, branch: BRANCH,
        description: "Ted to tighten up the team — think like a manager more and less like a technician.",
        status: "open",
      },
    });

    return { created: true as const, id: audit.id };
  } catch (e) {
    console.error("ensureOrlandoQ4AuditDraft:", e);
    return { error: String(e) };
  }
}
