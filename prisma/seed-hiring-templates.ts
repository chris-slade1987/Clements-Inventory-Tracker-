import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Off-the-shelf Hiring Template Library — the STARTING content HR edits/adds to.
// Seeds role-specific + default interview and screening templates, plus a
// categorized QuestionBankItem library HR can browse and insert à la carte.
//
// IDEMPOTENT: templates are keyed by a stable `seedKey` and only CREATED when
// missing — an existing seeded template (and any HR edits to it) is never
// clobbered on redeploy. Question-bank items are upserted by seedKey (safe to
// refresh — they're standalone reference rows, not authored templates).
// Wrapped NON-FATAL in deploy-db so a seed hiccup can never fail a deploy.
// ---------------------------------------------------------------------------

type RT = "rating_1_5" | "yes_no" | "text" | "basics_yesno_unsure";
type Q = { section?: string; text: string; responseType: RT; required?: boolean };
type TemplateSeed = {
  seedKey: string;
  kind: "interview" | "screening";
  name: string;
  description: string;
  roleKeys: string[];
  isDefault?: boolean;
  questions: Q[];
};

// Shared interview basics (basics_yesno_unsure).
const FIELD_BASICS: Q[] = [
  { text: "Holds a valid driver's license", responseType: "basics_yesno_unsure" },
  { text: "Reasonably clean motor-vehicle record (company vehicle)", responseType: "basics_yesno_unsure" },
  { text: "Able to lift up to ~50 lb and use ladders, with or without a reasonable accommodation", responseType: "basics_yesno_unsure" },
  { text: "Has reliable transportation to work", responseType: "basics_yesno_unsure" },
  { text: "Available for the required schedule, including some Saturdays", responseType: "basics_yesno_unsure" },
  { text: "Understands the role requires passing a pre-employment drug screen + background check", responseType: "basics_yesno_unsure" },
  { text: "Holds a Florida pesticide license, or is willing to certify", responseType: "basics_yesno_unsure" },
];

const CORE_BASICS: Q[] = [
  { text: "Holds a valid driver's license", responseType: "basics_yesno_unsure" },
  { text: "Has reliable transportation to work", responseType: "basics_yesno_unsure" },
  { text: "Available for the required schedule", responseType: "basics_yesno_unsure" },
  { text: "Understands the role requires passing a pre-employment drug screen + background check", responseType: "basics_yesno_unsure" },
];

// Common screening core (per spec) reused across every screening template.
const SCREENING_CORE: Q[] = [
  { section: "Interest & fit", text: "What interests you about this role at Clements, and what's your understanding of the day-to-day work?", responseType: "text", required: true },
  { section: "Availability", text: "Are you available for the schedule this role requires, including some Saturdays and occasional evenings?", responseType: "yes_no", required: true },
  { section: "Availability", text: "What's the earliest date you could start, and any scheduling constraints we should know about?", responseType: "text" },
  { section: "Compensation", text: "What are your compensation expectations for this role?", responseType: "text" },
  { section: "Logistics", text: "Do you have reliable transportation and a manageable commute to the branch?", responseType: "yes_no", required: true },
  { section: "Eligibility", text: "Are you legally authorized to work in the United States?", responseType: "yes_no", required: true },
  { section: "Eligibility", text: "Are you comfortable with a pre-employment drug screen and background check?", responseType: "yes_no", required: true },
  { section: "Communication", text: "Communication & professionalism on the call", responseType: "rating_1_5", required: true },
  { section: "Notes", text: "Any red flags or notes to pass to the interviewing supervisor", responseType: "text" },
];

const TEMPLATES: TemplateSeed[] = [
  // ---- Interview templates -------------------------------------------------
  {
    seedKey: "interview-technician",
    kind: "interview",
    name: "Pest Technician (field) interview",
    description: "Behavioral interview for field pest/lawn technicians — safety, thoroughness, at-the-door customer skill, driving, and coachability.",
    roleKeys: ["technician"],
    questions: [
      { section: "Reliability & attendance", text: "Tell me about a time you had to show up and perform under tough conditions — bad weather, a long day, short-staffed. How did you handle it?", responseType: "rating_1_5", required: true },
      { section: "Safety & pesticide/PPE mindset", text: "Walk me through how you follow safety rules and use protective equipment even when no one is watching. Any experience with regulated or chemical-handling work?", responseType: "rating_1_5", required: true },
      { section: "Treatment thoroughness & documentation", text: "Give an example of a job where being thorough and documenting your work really mattered. How do you make sure nothing gets missed?", responseType: "rating_1_5", required: true },
      { section: "At-the-door customer interaction", text: "Describe a time you dealt with an upset or skeptical customer at their home or business. What did you do and how did it end?", responseType: "rating_1_5", required: true },
      { section: "Physical / outdoor readiness", text: "This role means being on your feet outdoors in Florida heat, crawling in tight spaces, and lifting equipment. Tell me about physically demanding work you've done and how you stayed effective.", responseType: "rating_1_5", required: true },
      { section: "Driving & route professionalism", text: "You'd represent Clements in a branded truck at customers' properties all day. What does professionalism on the road and on-site mean to you?", responseType: "rating_1_5", required: true },
      { section: "Problem-solving in the field", text: "Tell me about a problem you solved on your own in the field when things didn't go as planned.", responseType: "rating_1_5", required: true },
      { section: "Coachability", text: "Describe a time you got tough feedback about your work. How did you respond?", responseType: "rating_1_5", required: true },
      ...FIELD_BASICS,
    ],
  },
  {
    seedKey: "interview-sales",
    kind: "interview",
    name: "Sales / Service Advisor interview",
    description: "Interview for sales / service advisors — consultative selling, objection handling, integrity, and follow-up discipline.",
    roleKeys: ["sales"],
    questions: [
      { section: "Consultative selling & rapport", text: "Tell me about a time you understood what a customer really needed and matched them to the right solution instead of just making a sale.", responseType: "rating_1_5", required: true },
      { section: "Handling objections", text: "Describe a tough objection you faced (price, timing, competitor) and how you worked through it.", responseType: "rating_1_5", required: true },
      { section: "Self-motivation vs. targets", text: "How do you keep yourself motivated against a number? Tell me about a goal you set and how you tracked toward it.", responseType: "rating_1_5", required: true },
      { section: "Explaining services honestly (integrity)", text: "Tell me about a time you chose to be fully honest with a customer even though it might cost you the sale.", responseType: "rating_1_5", required: true },
      { section: "Follow-up discipline", text: "Walk me through how you manage follow-ups and pipeline so leads don't fall through the cracks.", responseType: "rating_1_5", required: true },
      { section: "Driving & professionalism", text: "You'd travel to customers' homes and businesses representing Clements. What does being professional on the road and on-site mean to you?", responseType: "rating_1_5", required: true },
      ...CORE_BASICS,
    ],
  },
  {
    seedKey: "interview-manager",
    kind: "interview",
    name: "Service / Branch Manager interview",
    description: "Interview for service / branch managers — leadership, accountability, escalation handling, and compliance leadership.",
    roleKeys: ["manager"],
    questions: [
      { section: "Leadership & team development", text: "Tell me about a time you developed an underperforming team member into a strong contributor. What did you do?", responseType: "rating_1_5", required: true },
      { section: "Operational accountability & deadlines", text: "Describe how you keep a team hitting daily production and deadlines. Give a specific example of getting things back on track.", responseType: "rating_1_5", required: true },
      { section: "Conflict & customer-escalation handling", text: "Tell me about a serious customer escalation or team conflict you owned. How did you resolve it?", responseType: "rating_1_5", required: true },
      { section: "Safety / compliance leadership", text: "How do you build a culture where safety and regulatory compliance are non-negotiable? Share a time you enforced it.", responseType: "rating_1_5", required: true },
      { section: "Hiring & coaching", text: "Walk me through how you hire and coach. Tell me about a hiring or coaching decision you're proud of.", responseType: "rating_1_5", required: true },
      { section: "Culture", text: "What kind of team culture do you build, and what have you done to create it?", responseType: "rating_1_5", required: true },
      ...CORE_BASICS,
    ],
  },
  {
    seedKey: "interview-csr",
    kind: "interview",
    name: "Customer Service Rep (in-office) interview",
    description: "Interview for in-office CSRs — phone composure, empathy, software aptitude, multitasking, and teamwork with field crews.",
    roleKeys: ["csr"],
    questions: [
      { section: "Phone communication & composure under pressure", text: "Tell me about a time you handled a high-volume or high-stress phone situation calmly. How did you keep control?", responseType: "rating_1_5", required: true },
      { section: "Empathy with upset customers", text: "Describe a time you turned an upset customer around on the phone. What did you say and do?", responseType: "rating_1_5", required: true },
      { section: "Scheduling / CRM / software aptitude", text: "Walk me through your experience learning scheduling or CRM software. How quickly do you pick up new systems?", responseType: "rating_1_5", required: true },
      { section: "Multitasking & accuracy", text: "Give an example of juggling calls, scheduling, and data entry at once without letting accuracy slip.", responseType: "rating_1_5", required: true },
      { section: "Reliability", text: "Tell me about a time your reliability made a real difference to your team.", responseType: "rating_1_5", required: true },
      { section: "Teamwork with field crews", text: "Describe how you'd coordinate with technicians in the field to keep customers happy and routes on track.", responseType: "rating_1_5", required: true },
      ...CORE_BASICS,
    ],
  },
  {
    seedKey: "interview-default",
    kind: "interview",
    name: "General interview (default)",
    description: "Role-agnostic behavioral interview — the fallback used for any job without a role-specific template assigned.",
    roleKeys: ["any"],
    isDefault: true,
    questions: [
      { section: "Reliability & work ethic", text: "Tell me about a time you had to show up and perform under tough conditions (bad weather, a long day, short-staffed). How did you handle it?", responseType: "rating_1_5", required: true },
      { section: "Customer service & communication", text: "Describe a time you dealt with an upset or difficult customer. What did you do and how did it end?", responseType: "rating_1_5", required: true },
      { section: "Attention to detail & follow-through", text: "Give an example of a job where being thorough really mattered. How do you make sure nothing gets missed?", responseType: "rating_1_5", required: true },
      { section: "Safety & compliance mindset", text: "How do you approach following rules and procedures even when no one is watching? Any experience with safety protocols or regulated work?", responseType: "rating_1_5", required: true },
      { section: "Problem-solving & adaptability", text: "Tell me about a problem you solved on your own when things didn't go as planned.", responseType: "rating_1_5", required: true },
      { section: "Teamwork & coachability", text: "Describe a time you got tough feedback. How did you respond?", responseType: "rating_1_5", required: true },
      { section: "Professionalism & driving", text: "You'd represent Clements in a branded truck at customers' homes and businesses. What does being professional on the road and on-site mean to you? (Any driving record concerns?)", responseType: "rating_1_5", required: true },
      { section: "Motivation & role fit", text: "Why this role, and why Clements? Where do you want to grow?", responseType: "rating_1_5", required: true },
      { text: "Valid driver's license", responseType: "basics_yesno_unsure" },
      { text: "Comfortable with outdoor / physical work (lifting ~50 lb), with or without a reasonable accommodation", responseType: "basics_yesno_unsure" },
      { text: "Has reliable transportation", responseType: "basics_yesno_unsure" },
      { text: "Available for the required schedule", responseType: "basics_yesno_unsure" },
      { text: "Understands the pre-employment drug screen + background check", responseType: "basics_yesno_unsure" },
    ],
  },

  // ---- Screening-call templates --------------------------------------------
  {
    seedKey: "screening-technician",
    kind: "screening",
    name: "Pest Technician screening call",
    description: "Phone screen for field technicians — the common core plus outdoor/physical + pesticide + license confirmations.",
    roleKeys: ["technician"],
    questions: [
      ...SCREENING_CORE,
      { section: "Role add-ons", text: "This role is outdoors in Florida heat with physical work (lifting, ladders, crawlspaces) — are you comfortable meeting that requirement, with or without a reasonable accommodation?", responseType: "yes_no", required: true },
      { section: "Role add-ons", text: "Are you comfortable working around pesticides after full training and with proper protective equipment?", responseType: "yes_no", required: true },
      { section: "Role add-ons", text: "Do you have a valid driver's license (you'd drive a company vehicle)?", responseType: "yes_no", required: true },
    ],
  },
  {
    seedKey: "screening-csr",
    kind: "screening",
    name: "Customer Service Rep screening call",
    description: "Phone screen for in-office CSRs — the common core plus call-volume comfort and a stable office/remote setup.",
    roleKeys: ["csr"],
    questions: [
      ...SCREENING_CORE,
      { section: "Role add-ons", text: "This role handles a high volume of inbound and outbound calls — are you comfortable with that pace day to day?", responseType: "yes_no", required: true },
      { section: "Role add-ons", text: "Do you have a stable office or (if remote) home setup — reliable internet and a quiet space to take calls?", responseType: "yes_no", required: true },
    ],
  },
  {
    seedKey: "screening-default",
    kind: "screening",
    name: "General screening call (default)",
    description: "Role-agnostic phone screen — the common core, used for any job without a role-specific screening template assigned.",
    roleKeys: ["any"],
    isDefault: true,
    questions: [...SCREENING_CORE],
  },
];

// ---- Off-the-shelf question bank (categorized, à-la-carte) ------------------
type BankSeed = { seedKey: string; kind: "interview" | "screening"; category: string; roleHint: string; text: string; responseType: RT };

const BANK: BankSeed[] = [
  // Interview — reliability
  { seedKey: "bank-i-reliability-1", kind: "interview", category: "Reliability", roleHint: "any", text: "Tell me about a time you had to show up and perform under tough conditions. How did you handle it?", responseType: "rating_1_5" },
  { seedKey: "bank-i-reliability-2", kind: "interview", category: "Reliability", roleHint: "any", text: "Describe your attendance and punctuality track record. What keeps you dependable?", responseType: "rating_1_5" },
  // Interview — safety
  { seedKey: "bank-i-safety-1", kind: "interview", category: "Safety", roleHint: "technician", text: "Walk me through how you follow safety and PPE rules even when no one is watching. Any regulated-work experience?", responseType: "rating_1_5" },
  { seedKey: "bank-i-safety-2", kind: "interview", category: "Safety", roleHint: "technician", text: "Tell me about a time you spotted a safety risk and acted on it.", responseType: "rating_1_5" },
  // Interview — customer service
  { seedKey: "bank-i-customer-1", kind: "interview", category: "Customer service", roleHint: "any", text: "Describe a time you dealt with an upset or difficult customer. What did you do and how did it end?", responseType: "rating_1_5" },
  { seedKey: "bank-i-customer-2", kind: "interview", category: "Customer service", roleHint: "csr", text: "Tell me about turning an unhappy customer into a satisfied one on the phone.", responseType: "rating_1_5" },
  // Interview — thoroughness
  { seedKey: "bank-i-detail-1", kind: "interview", category: "Attention to detail", roleHint: "any", text: "Give an example of a job where being thorough really mattered. How do you make sure nothing gets missed?", responseType: "rating_1_5" },
  { seedKey: "bank-i-detail-2", kind: "interview", category: "Attention to detail", roleHint: "technician", text: "How do you document your work so the next tech (or the customer) has an accurate record?", responseType: "rating_1_5" },
  // Interview — problem solving
  { seedKey: "bank-i-problem-1", kind: "interview", category: "Problem-solving", roleHint: "any", text: "Tell me about a problem you solved on your own when things didn't go as planned.", responseType: "rating_1_5" },
  // Interview — coachability
  { seedKey: "bank-i-coach-1", kind: "interview", category: "Coachability", roleHint: "any", text: "Describe a time you got tough feedback. How did you respond?", responseType: "rating_1_5" },
  // Interview — driving
  { seedKey: "bank-i-driving-1", kind: "interview", category: "Driving & professionalism", roleHint: "technician", text: "You'd drive a branded company truck to customers' properties. What does professionalism on the road mean to you?", responseType: "rating_1_5" },
  // Interview — leadership
  { seedKey: "bank-i-leadership-1", kind: "interview", category: "Leadership", roleHint: "manager", text: "Tell me about developing an underperforming team member into a strong contributor.", responseType: "rating_1_5" },
  { seedKey: "bank-i-leadership-2", kind: "interview", category: "Leadership", roleHint: "manager", text: "How do you hold a team accountable to daily production and deadlines?", responseType: "rating_1_5" },
  // Interview — sales
  { seedKey: "bank-i-sales-1", kind: "interview", category: "Sales", roleHint: "sales", text: "Tell me about matching a customer to the right solution instead of just making a sale.", responseType: "rating_1_5" },
  { seedKey: "bank-i-sales-2", kind: "interview", category: "Sales", roleHint: "sales", text: "Describe a tough objection you worked through to close.", responseType: "rating_1_5" },
  // Interview — motivation
  { seedKey: "bank-i-motivation-1", kind: "interview", category: "Motivation & fit", roleHint: "any", text: "Why this role, and why Clements? Where do you want to grow?", responseType: "rating_1_5" },
  // Interview basics
  { seedKey: "bank-i-basic-license", kind: "interview", category: "Basics", roleHint: "any", text: "Holds a valid driver's license", responseType: "basics_yesno_unsure" },
  { seedKey: "bank-i-basic-lift", kind: "interview", category: "Basics", roleHint: "technician", text: "Able to lift up to ~50 lb and use ladders, with or without a reasonable accommodation", responseType: "basics_yesno_unsure" },
  { seedKey: "bank-i-basic-schedule", kind: "interview", category: "Basics", roleHint: "any", text: "Available for the required schedule, including some Saturdays", responseType: "basics_yesno_unsure" },
  { seedKey: "bank-i-basic-license-pest", kind: "interview", category: "Basics", roleHint: "technician", text: "Holds a Florida pesticide license, or is willing to certify", responseType: "basics_yesno_unsure" },

  // Screening — basics
  { seedKey: "bank-s-interest-1", kind: "screening", category: "Screening basics", roleHint: "any", text: "What interests you about this role, and what's your understanding of the day-to-day work?", responseType: "text" },
  { seedKey: "bank-s-availability-1", kind: "screening", category: "Availability", roleHint: "any", text: "Are you available for the schedule this role requires, including some Saturdays and occasional evenings?", responseType: "yes_no" },
  { seedKey: "bank-s-start-1", kind: "screening", category: "Availability", roleHint: "any", text: "What's the earliest date you could start, and any scheduling constraints?", responseType: "text" },
  { seedKey: "bank-s-comp-1", kind: "screening", category: "Compensation", roleHint: "any", text: "What are your compensation expectations for this role?", responseType: "text" },
  { seedKey: "bank-s-transport-1", kind: "screening", category: "Logistics", roleHint: "any", text: "Do you have reliable transportation and a manageable commute to the branch?", responseType: "yes_no" },
  { seedKey: "bank-s-authorized-1", kind: "screening", category: "Eligibility", roleHint: "any", text: "Are you legally authorized to work in the United States?", responseType: "yes_no" },
  { seedKey: "bank-s-screen-1", kind: "screening", category: "Eligibility", roleHint: "any", text: "Are you comfortable with a pre-employment drug screen and background check?", responseType: "yes_no" },
  { seedKey: "bank-s-comm-1", kind: "screening", category: "Communication", roleHint: "any", text: "Communication & professionalism on the call", responseType: "rating_1_5" },
  { seedKey: "bank-s-redflag-1", kind: "screening", category: "Notes", roleHint: "any", text: "Any red flags or notes to pass to the interviewing supervisor", responseType: "text" },
  // Screening — field add-ons
  { seedKey: "bank-s-outdoor-1", kind: "screening", category: "Field readiness", roleHint: "technician", text: "This role is outdoors with physical work — are you comfortable meeting that requirement, with or without a reasonable accommodation?", responseType: "yes_no" },
  { seedKey: "bank-s-pesticide-1", kind: "screening", category: "Field readiness", roleHint: "technician", text: "Are you comfortable working around pesticides after full training and with proper protective equipment?", responseType: "yes_no" },
  { seedKey: "bank-s-license-1", kind: "screening", category: "Field readiness", roleHint: "technician", text: "Do you have a valid driver's license (you'd drive a company vehicle)?", responseType: "yes_no" },
  // Screening — CSR add-ons
  { seedKey: "bank-s-callvolume-1", kind: "screening", category: "Office readiness", roleHint: "csr", text: "Are you comfortable with a high volume of inbound and outbound calls day to day?", responseType: "yes_no" },
  { seedKey: "bank-s-setup-1", kind: "screening", category: "Office readiness", roleHint: "csr", text: "Do you have a stable office or (if remote) home setup with reliable internet and a quiet space?", responseType: "yes_no" },
];

export async function seedHiringTemplates(prisma: PrismaClient) {
  let templatesCreated = 0;
  let templatesSkipped = 0;
  for (const t of TEMPLATES) {
    const existing = await prisma.hiringTemplate.findUnique({ where: { seedKey: t.seedKey }, select: { id: true } });
    if (existing) {
      templatesSkipped++;
      continue; // never clobber an existing seeded template or HR's edits to it
    }
    await prisma.hiringTemplate.create({
      data: {
        seedKey: t.seedKey,
        kind: t.kind,
        name: t.name,
        description: t.description,
        roleKeys: JSON.stringify(t.roleKeys),
        isDefault: !!t.isDefault,
        createdByName: "Off-the-shelf library",
        questions: {
          create: t.questions.map((q, i) => ({ section: q.section ?? null, text: q.text, responseType: q.responseType, required: !!q.required, order: i })),
        },
      },
    });
    templatesCreated++;
  }

  let bankUpserted = 0;
  for (const b of BANK) {
    await prisma.questionBankItem.upsert({
      where: { seedKey: b.seedKey },
      update: { kind: b.kind, category: b.category, roleHint: b.roleHint, text: b.text, responseType: b.responseType, active: true },
      create: { seedKey: b.seedKey, kind: b.kind, category: b.category, roleHint: b.roleHint, text: b.text, responseType: b.responseType, active: true },
    });
    bankUpserted++;
  }

  return { templatesCreated, templatesSkipped, templatesTotal: TEMPLATES.length, bankUpserted };
}

// Standalone run: `tsx prisma/seed-hiring-templates.ts`
if (process.argv[1] && process.argv[1].endsWith("seed-hiring-templates.ts")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await seedHiringTemplates(prisma);
      console.log(`seed-hiring-templates: ${r.templatesCreated} templates created, ${r.templatesSkipped} already present; ${r.bankUpserted} question-bank items upserted.`);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
