import { PrismaClient } from "@prisma/client";

// Manager oversight checklists. Idempotent: upsert by template `key` so a
// redeploy refreshes the items (stable item ids "w1".., "m1"..) without ever
// touching signed completions. Item shape: { id, order, category, label, objective }.
// The weekly checklist is the ONLY active oversight checklist — it reads as a
// quick, scannable run-through (no time stamps). The monthly oversight checklist
// is deactivated (active:false) but never hard-deleted, so its signed history
// stays intact and the schema stays cadence-generic for the future.

type SeedItem = { id: string; category: string; label: string; objective: string };

// Short, scannable weekly oversight list. Item ids are preserved from the
// original longer list so previously-signed completions still map to their
// items. (The removed items — inbox follow-up, sales-lead follow-up, agreements,
// vehicles/office cleanliness, final wrap-up — remain in the Manager Manual's
// Weekly Responsibilities; they were trimmed from the sign-off checklist to keep
// it quick.)
const WEEKLY_ITEMS: SeedItem[] = [
  {
    id: "w2",
    category: "Operational",
    label: "Weekly production report",
    objective: "Review weekly production to ensure the branch is on track to hit the month's estimated production.",
  },
  {
    id: "w3",
    category: "Operational",
    label: "Missed accounts & rescheduling",
    objective:
      "Review each technician's prior five-day schedule; every missed service (sick/weather/etc.) must be rescheduled within 7 days of the original date.",
  },
  {
    id: "w6",
    category: "Operational",
    label: "Cancellations",
    objective: "Review the cancellation report; make sure technicians aren't driving unnecessary cancellations.",
  },
  {
    id: "w7",
    category: "Operational",
    label: "Technician schedules for next week",
    objective: "Every technician is ready for Monday — schedule set, paperwork in hand, no blockers.",
  },
  {
    id: "w10",
    category: "Operational",
    label: "Inventory disbursement & expenses logged",
    objective:
      "Record the week's chemical disbursements — check-outs to technicians are logged under Check-Out — and scan all expense receipts.",
  },
  {
    id: "w11",
    category: "Operational",
    label: "Bank deposits",
    objective: "Collect customer payments from techs, write up the deposit, and take it to the bank Friday afternoon.",
  },
];

const MONTHLY_ITEMS: SeedItem[] = [
  { id: "m1", category: "Operational", label: "Vehicle inspections", objective: "Complete the inspection form for each vehicle." },
  { id: "m2", category: "Operational", label: "Vehicle maintenance & logging", objective: "Perform and log vehicle maintenance." },
  { id: "m3", category: "Operational", label: "Small machinery/equipment maintenance & logging", objective: "Perform and log small machinery/equipment maintenance." },
  { id: "m4", category: "Operational", label: "Warehouse safety inspection & logging", objective: "Complete and log the warehouse safety inspection." },
  { id: "m5", category: "Operational", label: "Review monthly technician training lessons", objective: "Review the month's technician training lessons." },
  { id: "m6", category: "Operational", label: "Confirm technicians are using only approved products & techniques", objective: "Confirm technicians are using only approved products & techniques." },
  { id: "m7", category: "Operational", label: "Prep for the Director of Field Operations' on-site visit", objective: "Prepare the branch for the Director of Field Operations' on-site visit." },
  { id: "m8", category: "KPI Review", label: "Review prior-month KPIs ahead of the All-Hands", objective: "Review prior-month KPIs ahead of the All-Hands (always compare budget to actual)." },
  { id: "m9", category: "KPI Review", label: "Gather the month's marketing efforts to discuss at the All-Hands", objective: "Gather the month's marketing efforts to discuss at the All-Hands." },
  { id: "m10", category: "Sales / Sales Center", label: "Ensure all leads are followed up and older leads (60+ days) are closed-lost in the sales center", objective: "Ensure all leads are followed up and older leads (60+ days) are closed-lost in the sales center." },
  { id: "m11", category: "Sales / Sales Center", label: "Review sales & marketing initiatives", objective: "Review sales & marketing initiatives." },
  { id: "m12", category: "Planning", label: "Review tank mixes / products for the month ahead", objective: "Review tank mixes / products for the month ahead." },
  { id: "m13", category: "Planning", label: "Order inventory based on the tank-mix spreadsheet", objective: "Order inventory based on the tank-mix spreadsheet." },
];

function withOrder(items: SeedItem[]) {
  return items.map((it, i) => ({ ...it, order: i + 1 }));
}

const TEMPLATES = [
  {
    key: "weekly",
    title: "Weekly Oversight Checklist",
    cadence: "weekly",
    intro: "Work top to bottom, then sign off.",
    items: withOrder(WEEKLY_ITEMS),
    active: true,
  },
  {
    // Deactivated: the owner removed the monthly OVERSIGHT checklist. We upsert
    // it as active:false (never hard-delete) so its signed history is retained
    // and the UI, which only ever enumerates active templates, no longer shows
    // it. Every OTHER monthly task (vehicle inspections, etc.) is untouched —
    // those live outside this checklist template.
    key: "monthly",
    title: "Monthly Oversight Checklist",
    cadence: "monthly",
    intro: "Once a month — the strategic checkpoint. Complete and sign before the All-Hands.",
    items: withOrder(MONTHLY_ITEMS),
    active: false,
  },
];

export async function seedChecklists(prisma: PrismaClient) {
  const counts: Record<string, number> = {};
  for (const t of TEMPLATES) {
    const data = {
      title: t.title,
      cadence: t.cadence,
      intro: t.intro,
      items: JSON.stringify(t.items),
      active: t.active,
    };
    await prisma.checklistTemplate.upsert({
      where: { key: t.key },
      update: data,
      create: { key: t.key, ...data },
    });
    counts[t.key] = t.items.length;
  }
  return counts;
}

if (process.argv[1] && process.argv[1].includes("seed-checklists")) {
  const prisma = new PrismaClient();
  seedChecklists(prisma)
    .then((c) => console.log(`Seeded checklists: weekly=${c.weekly} items (active), monthly=${c.monthly} items (INACTIVE — retained as history).`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
