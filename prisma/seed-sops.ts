import { PrismaClient } from "@prisma/client";

// Example Standard Operating Procedures (CanopyOS Theme 2). These prove the
// generalized SOP runner: NON-cadence (ad-hoc) procedures, versioned, with the
// RICHER step types the legacy weekly/monthly checklists never had — check, text,
// number, and photo/evidence. Idempotent: upsert by template `key` (stable step
// ids) so a redeploy refreshes the steps without ever touching the append-only
// signed completions or the assignment ledger.
//
// These are ChecklistTemplate rows with kind="sop", cadence="none",
// dueRule="adhoc" — so they never appear in the weekly/monthly checklist screens,
// only in the SOP runner (lib/sop.ts). Branch managers run them from
// My Branch -> SOPs; admins/leadership publish & assign them in the SOP Library.

type SeedStep = {
  id: string;
  category: string;
  label: string;
  objective: string;
  type?: "check" | "text" | "number" | "photo";
  required?: boolean;
  help?: string;
};

// SOP 1 — Branch Open / Close. A phone-first daily open/close walk-through.
const BRANCH_OPEN_CLOSE: SeedStep[] = [
  { id: "boc1", category: "Open", label: "Unlock & disarm", objective: "Unlock the branch, disarm the alarm, and confirm no overnight alerts.", type: "check", required: true },
  { id: "boc2", category: "Open", label: "Warehouse walk-through", objective: "Walk the warehouse — no leaks, spills, or pest activity; aisles clear.", type: "check", required: true },
  { id: "boc3", category: "Open", label: "Thermostat / cooler reading", objective: "Record the chemical storage temperature.", type: "number", help: "Degrees Fahrenheit." },
  { id: "boc4", category: "Open", label: "Vehicles staged", objective: "Confirm every technician's truck is fueled, loaded, and ready to roll.", type: "check", required: true },
  { id: "boc5", category: "Close", label: "Cash & deposits secured", objective: "Count the drawer, secure any customer payments for deposit.", type: "check", required: true },
  { id: "boc6", category: "Close", label: "Doors & gates locked", objective: "Lock all doors and the yard gate; arm the alarm.", type: "check", required: true },
  { id: "boc7", category: "Close", label: "Storefront photo", objective: "Snap a photo of the secured storefront/warehouse as end-of-day evidence.", type: "photo" },
  { id: "boc8", category: "Close", label: "Notes for tomorrow", objective: "Anything the morning shift needs to know.", type: "text" },
];

// SOP 2 — New-Vehicle Onboarding. Run once when a vehicle enters the fleet.
const NEW_VEHICLE_ONBOARDING: SeedStep[] = [
  { id: "nvo1", category: "Identity", label: "Unit number assigned", objective: "Record the branch unit number for the new vehicle.", type: "text", required: true },
  { id: "nvo2", category: "Identity", label: "Odometer at intake", objective: "Record the starting mileage.", type: "number", required: true, help: "Whole miles." },
  { id: "nvo3", category: "Documents", label: "Registration & insurance on file", objective: "Upload registration and the insurance card to the vehicle's documents in Fleet.", type: "check", required: true },
  { id: "nvo4", category: "Documents", label: "VIN plate photo", objective: "Photograph the VIN plate for the record.", type: "photo" },
  { id: "nvo5", category: "Setup", label: "Spill kit & PPE stocked", objective: "Confirm the spill kit, fire extinguisher, and PPE are on board.", type: "check", required: true },
  { id: "nvo6", category: "Setup", label: "Branding & decals applied", objective: "Clements decals and license-plate frame applied.", type: "check" },
  { id: "nvo7", category: "Setup", label: "Driver assigned", objective: "Record the technician the vehicle is assigned to.", type: "text" },
  { id: "nvo8", category: "Handover", label: "Walk-around condition notes", objective: "Note any existing dents/scratches so later damage is attributable.", type: "text" },
];

function withOrder(items: SeedStep[]) {
  return items.map((it, i) => ({ ...it, order: i + 1 }));
}

const SOPS = [
  {
    key: "branch-open-close",
    title: "Branch Open / Close",
    category: "Branch operations",
    intro: "The daily open and close walk-through — secure the branch, stage the fleet, and leave a clean hand-off.",
    version: 1,
    steps: withOrder(BRANCH_OPEN_CLOSE),
  },
  {
    key: "new-vehicle-onboarding",
    title: "New-Vehicle Onboarding",
    category: "Fleet",
    intro: "Run once when a vehicle joins the branch fleet — identity, documents, safety kit, and hand-over.",
    version: 1,
    steps: withOrder(NEW_VEHICLE_ONBOARDING),
  },
];

export async function seedSops(prisma: PrismaClient) {
  const counts: Record<string, number> = {};
  for (const s of SOPS) {
    const data = {
      title: s.title,
      cadence: "none",
      intro: s.intro,
      items: JSON.stringify(s.steps),
      active: true,
      kind: "sop",
      version: s.version,
      dueRule: "adhoc",
      category: s.category,
    };
    await prisma.checklistTemplate.upsert({
      where: { key: s.key },
      update: data,
      create: { key: s.key, ...data },
    });
    counts[s.key] = s.steps.length;
  }
  return counts;
}

/** Seed ONE open assignment of the Branch Open/Close SOP per branch so the
 *  "Due now" surface has something real to run. Idempotent: skips a branch that
 *  already has an open assignment of this SOP. Never touches completed/cancelled
 *  assignments (append-only ledger). */
export async function seedSopAssignments(prisma: PrismaClient) {
  const BRANCHES = ["vero", "stuart", "orlando", "naples"];
  const template = await prisma.checklistTemplate.findFirst({ where: { key: "branch-open-close", kind: "sop" } });
  if (!template) return 0;
  let created = 0;
  for (const branch of BRANCHES) {
    const existing = await prisma.sopAssignment.findFirst({
      where: { templateId: template.id, branch, status: "open" },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.sopAssignment.create({
      data: {
        templateId: template.id,
        templateVersion: template.version,
        branch,
        assignedByName: "Field Operations",
        note: "Daily open/close — complete and sign at the start/end of each day.",
      },
    });
    created++;
  }
  return created;
}

if (process.argv[1] && process.argv[1].includes("seed-sops")) {
  const prisma = new PrismaClient();
  seedSops(prisma)
    .then(async (c) => {
      const asg = await seedSopAssignments(prisma);
      console.log(`Seeded SOPs: ${Object.entries(c).map(([k, v]) => `${k}=${v} steps`).join(", ")}; ${asg} open assignment(s) created.`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
