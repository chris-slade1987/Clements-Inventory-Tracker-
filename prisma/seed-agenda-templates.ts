import type { PrismaClient } from "@prisma/client";

// Seed the Huddle agenda templates (Groundwork, Round 1-A). Idempotent upsert by
// `key`: refreshes name/kind/items/active without creating duplicates, so it is
// safe to run on every deploy and locally. Each template's `items` is a JSON
// array [{order,title,prompt?}] copied into MeetingAgendaItem by
// applyAgendaTemplate(meetingId, key).

type TemplateItem = { order: number; title: string; prompt?: string };
type TemplateSeed = { key: string; name: string; kind: string; items: TemplateItem[] };

export const AGENDA_TEMPLATES: TemplateSeed[] = [
  {
    key: "sales_director_weekly",
    name: "Sales Director Weekly",
    kind: "sales",
    items: [
      { order: 0, title: "Last week's numbers", prompt: "New sales, closes, and pace vs. goal by advisor." },
      { order: 1, title: "Pipeline & funnel", prompt: "Leads → proposals → closes; where deals are stuck." },
      { order: 2, title: "Wins & blockers", prompt: "Celebrate wins; surface what's getting in the way." },
      { order: 3, title: "Focus initiatives", prompt: "This week's networking, cross-sell, and drop-off plans." },
      { order: 4, title: "Follow-ups", prompt: "Assign owners + due dates for everything decided today." },
    ],
  },
  {
    key: "marketing",
    name: "Marketing",
    kind: "marketing",
    items: [
      { order: 0, title: "Campaign performance", prompt: "Lead volume + cost per lead by channel (BNI, referral, web)." },
      { order: 1, title: "Lead source review", prompt: "Which sources are converting; where to double down." },
      { order: 2, title: "Content & creative", prompt: "In-flight assets, launches, and approvals needed." },
      { order: 3, title: "Branch requests", prompt: "What the branches need from marketing this period." },
      { order: 4, title: "Follow-ups", prompt: "Owners + due dates for every action item." },
    ],
  },
  {
    key: "branch_ops",
    name: "Branch / Ops",
    kind: "ops",
    items: [
      { order: 0, title: "Safety & compliance", prompt: "Inspections, licenses, incidents since last Huddle." },
      { order: 1, title: "Production & scheduling", prompt: "Routes, capacity, and service backlog." },
      { order: 2, title: "Inventory & fleet", prompt: "Low stock / reorders, vehicle service & registration." },
      { order: 3, title: "People", prompt: "Open roles, training, PTO, and recognition." },
      { order: 4, title: "Follow-ups", prompt: "Assign owners + due dates for everything decided today." },
    ],
  },
  {
    key: "one_on_one",
    name: "1:1",
    kind: "one_on_one",
    items: [
      { order: 0, title: "Wins since last time", prompt: "What went well; what they're proud of." },
      { order: 1, title: "Challenges & blockers", prompt: "Where they're stuck and how you can help." },
      { order: 2, title: "Goals & development", prompt: "Progress on goals; growth and coaching." },
      { order: 3, title: "Feedback (both ways)", prompt: "What's working; what to adjust — for both of you." },
      { order: 4, title: "Follow-ups", prompt: "Commitments + due dates for both of you." },
    ],
  },
];

export async function seedAgendaTemplates(prisma: PrismaClient): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const t of AGENDA_TEMPLATES) {
    await prisma.agendaTemplate.upsert({
      where: { key: t.key },
      create: { key: t.key, name: t.name, kind: t.kind, items: JSON.stringify(t.items), active: true },
      update: { name: t.name, kind: t.kind, items: JSON.stringify(t.items), active: true },
    });
    upserted++;
  }
  return { upserted };
}
