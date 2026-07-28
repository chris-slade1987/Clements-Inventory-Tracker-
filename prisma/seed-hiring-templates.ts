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

// Experience-based structured interview — the arc the CEO wants: dig into what
// the candidate actually DID, get technical, then explore likes/dislikes,
// motivation for the change, what they valued, where they grew, where they want
// to keep growing, and their ideal role. Mirrors how top employers (Google,
// Delta, PepsiCo, Terminix/Orkin) run structured behavioral interviews. Scored
// 1–5 so the scorecard + recommendation still work.
const CAREER_OPENERS: Q[] = [
  { section: "Work history", text: "Walk me through your work history — the roles you've held, what you actually did in each, and what you were responsible for day to day.", responseType: "rating_1_5", required: true },
  { section: "A day in the role", text: "Think of the past job most like this one. Describe a typical day start to finish — the real tasks, the tools you used, and the calls you had to make.", responseType: "rating_1_5", required: true },
];

const CAREER_REFLECTION: Q[] = [
  { section: "Likes & dislikes", text: "What did you enjoy most in your recent roles, and what did you like least? Be candid — it helps us make sure this is the right fit.", responseType: "rating_1_5", required: true },
  { section: "What you valued most", text: "What did you value most about your last job (or jobs) — the work itself, the people, how it was run? What made it matter to you?", responseType: "rating_1_5", required: true },
  { section: "Where you grew", text: "Where did you grow the most in your last few roles — a skill or area where you got noticeably better — and what drove that growth?", responseType: "rating_1_5", required: true },
  { section: "Where you're still growing", text: "Where do you most want to keep improving, and what are you actively doing to get better at it?", responseType: "rating_1_5", required: true },
  { section: "Why a change now", text: "Why are you looking to make a move now, and what are you hoping to find here that you don't have today?", responseType: "rating_1_5", required: true },
  { section: "Your ideal role", text: "If you could design the perfect role for yourself, what would it look like day to day — and how does this role line up with that?", responseType: "rating_1_5", required: true },
];

const TEMPLATES: TemplateSeed[] = [
  // ---- Interview templates -------------------------------------------------
  {
    seedKey: "interview-technician",
    kind: "interview",
    name: "Pest Technician (field) interview",
    description: "Experience-based interview for field pest/lawn technicians — past roles, technical field depth, motivation, and growth.",
    roleKeys: ["technician"],
    questions: [
      ...CAREER_OPENERS,
      { section: "Technical depth (field)", text: "Get technical with me: pick a job type you've done — an ant or roach callback, a rodent job, a termite or lawn/ornamental treatment — and walk me through it end to end. What did you inspect, what products and equipment did you use and why, and how did you know it worked?", responseType: "rating_1_5", required: true },
      { section: "Safety & chemical handling", text: "Tell me about your hands-on experience handling chemicals or working under safety/PPE rules. How do you keep yourself and the customer safe when you're busy and behind?", responseType: "rating_1_5", required: true },
      { section: "Thoroughness in the field", text: "Give an example of a job where being thorough — and documenting it — really mattered. How do you make sure nothing gets missed on a property?", responseType: "rating_1_5", required: true },
      ...CAREER_REFLECTION,
      ...FIELD_BASICS,
    ],
  },
  {
    seedKey: "interview-sales",
    kind: "interview",
    name: "Sales / Service Advisor interview",
    description: "Experience-based interview for sales / service advisors — past sales roles, deal craft, motivation, and growth.",
    roleKeys: ["sales"],
    questions: [
      ...CAREER_OPENERS,
      { section: "Technical depth (sales)", text: "Get into your sales craft: walk me through your process on a deal you're proud of, from first contact to close — how you qualified the customer, what you presented, and how you handled the money conversation.", responseType: "rating_1_5", required: true },
      { section: "Handling objections", text: "Tell me about the toughest objection you faced recently — price, timing, a competitor — and exactly how you worked through it.", responseType: "rating_1_5", required: true },
      { section: "Numbers & follow-up", text: "How have you performed against a quota, and how do you manage your follow-ups and pipeline so leads don't fall through the cracks?", responseType: "rating_1_5", required: true },
      ...CAREER_REFLECTION,
      ...CORE_BASICS,
    ],
  },
  {
    seedKey: "interview-manager",
    kind: "interview",
    name: "Service / Branch Manager interview",
    description: "Experience-based interview for service / branch managers — how they've actually run teams, hard decisions, motivation, and growth.",
    roleKeys: ["manager"],
    questions: [
      ...CAREER_OPENERS,
      { section: "Technical depth (leadership)", text: "Get into how you actually run a team: walk me through how you manage a day — production targets, accountability, coaching in the moment — using a real example from a team you led.", responseType: "rating_1_5", required: true },
      { section: "A hard people decision", text: "Tell me about the hardest people decision you've owned — a termination, a serious conflict, or a turnaround — and how you handled it start to finish.", responseType: "rating_1_5", required: true },
      { section: "Safety / compliance leadership", text: "How have you built a culture where safety and regulatory compliance are non-negotiable? Give me a time you had to enforce it.", responseType: "rating_1_5", required: true },
      ...CAREER_REFLECTION,
      ...CORE_BASICS,
    ],
  },
  {
    seedKey: "interview-csr",
    kind: "interview",
    name: "Customer Service Rep (in-office) interview",
    description: "Experience-based interview for in-office CSRs — past office/phone roles, systems used, motivation, and growth.",
    roleKeys: ["csr"],
    questions: [
      ...CAREER_OPENERS,
      { section: "Technical depth (office)", text: "Get into the office craft: walk me through a busy shift juggling a full phone queue, scheduling, and data entry — what systems (CRM, scheduling, phone) you used and how you kept everything accurate.", responseType: "rating_1_5", required: true },
      { section: "Turning a call around", text: "Tell me about a difficult call you turned around — an upset customer or a scheduling mess — and exactly what you said and did.", responseType: "rating_1_5", required: true },
      { section: "Learning new systems", text: "How quickly do you pick up new software? Give me an example of a system you learned fast and how you got up to speed.", responseType: "rating_1_5", required: true },
      ...CAREER_REFLECTION,
      ...CORE_BASICS,
    ],
  },
  {
    seedKey: "interview-default",
    kind: "interview",
    name: "General interview (default)",
    description: "Role-agnostic experience-based interview — the fallback used for any job without a role-specific template assigned.",
    roleKeys: ["any"],
    isDefault: true,
    questions: [
      ...CAREER_OPENERS,
      { section: "Technical / role depth", text: "Get specific about the work you'd do here: walk me through the part of your past experience most relevant to this role — the actual tasks and exactly how you approached them.", responseType: "rating_1_5", required: true },
      { section: "Thoroughness & follow-through", text: "Give an example of a job where being thorough really mattered. How do you make sure nothing gets missed?", responseType: "rating_1_5", required: true },
      ...CAREER_REFLECTION,
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
  // Interview — experience & background (the CEO's preferred deep-dive arc)
  { seedKey: "bank-i-exp-history", kind: "interview", category: "Experience & background", roleHint: "any", text: "Walk me through your work history — what you actually did in each role and what you were responsible for day to day.", responseType: "rating_1_5" },
  { seedKey: "bank-i-exp-day", kind: "interview", category: "Experience & background", roleHint: "any", text: "Think of the past job most like this one — describe a typical day start to finish, with the real tasks and tools.", responseType: "rating_1_5" },
  { seedKey: "bank-i-exp-technical", kind: "interview", category: "Experience & background", roleHint: "any", text: "Get technical: walk me through the part of your experience most relevant here, end to end — what you did and why.", responseType: "rating_1_5" },
  { seedKey: "bank-i-exp-likes", kind: "interview", category: "Experience & background", roleHint: "any", text: "What did you enjoy most in your recent roles, and what did you like least?", responseType: "rating_1_5" },
  { seedKey: "bank-i-exp-valued", kind: "interview", category: "Experience & background", roleHint: "any", text: "What did you value most about your last job — the work, the people, how it was run — and why?", responseType: "rating_1_5" },
  { seedKey: "bank-i-exp-grew", kind: "interview", category: "Experience & background", roleHint: "any", text: "Where did you grow the most recently, and what drove that growth?", responseType: "rating_1_5" },
  { seedKey: "bank-i-exp-growing", kind: "interview", category: "Experience & background", roleHint: "any", text: "Where do you most want to keep improving, and what are you doing about it?", responseType: "rating_1_5" },
  { seedKey: "bank-i-exp-change", kind: "interview", category: "Experience & background", roleHint: "any", text: "Why are you making a move now, and what are you hoping to find that you don't have today?", responseType: "rating_1_5" },
  { seedKey: "bank-i-exp-ideal", kind: "interview", category: "Experience & background", roleHint: "any", text: "If you could design the perfect role for yourself, what would it look like day to day?", responseType: "rating_1_5" },
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

// Forward-only content version. BUMP this when the seeded INTERVIEW templates'
// question content is intentionally revised and must overwrite the previously
// seeded content on live (which is otherwise create-if-missing). A bump re-syncs
// the seed-owned interview templates ONCE — it will overwrite HR's edits to
// those specific templates, so bump only for authoritative content changes.
// v2: CEO-preferred experience-based interview arc (Jul 2026).
const INTERVIEW_CONTENT_VERSION = 2;
const INTERVIEW_VERSION_KEY = "hiringInterviewSeedVersion";

export async function seedHiringTemplates(prisma: PrismaClient) {
  const versionRow = await prisma.setting.findUnique({ where: { key: INTERVIEW_VERSION_KEY } }).catch(() => null);
  const storedVersion = Number.parseInt(versionRow?.value ?? "0", 10) || 0;
  const refreshInterviews = INTERVIEW_CONTENT_VERSION > storedVersion;

  let templatesCreated = 0;
  let templatesSkipped = 0;
  let templatesRefreshed = 0;
  for (const t of TEMPLATES) {
    const existing = await prisma.hiringTemplate.findUnique({ where: { seedKey: t.seedKey }, select: { id: true } });
    if (existing) {
      // One-time authoritative refresh of the seed-owned INTERVIEW templates so
      // a live site picks up revised question content on a version bump.
      if (refreshInterviews && t.kind === "interview") {
        await prisma.hiringTemplateQuestion.deleteMany({ where: { templateId: existing.id } });
        await prisma.hiringTemplate.update({
          where: { id: existing.id },
          data: {
            name: t.name,
            description: t.description,
            roleKeys: JSON.stringify(t.roleKeys),
            isDefault: !!t.isDefault,
            questions: {
              create: t.questions.map((q, i) => ({ section: q.section ?? null, text: q.text, responseType: q.responseType, required: !!q.required, order: i })),
            },
          },
        });
        templatesRefreshed++;
      } else {
        templatesSkipped++;
      }
      continue; // otherwise never clobber an existing seeded template or HR's edits
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

  if (refreshInterviews) {
    await prisma.setting.upsert({
      where: { key: INTERVIEW_VERSION_KEY },
      update: { value: String(INTERVIEW_CONTENT_VERSION) },
      create: { key: INTERVIEW_VERSION_KEY, value: String(INTERVIEW_CONTENT_VERSION) },
    });
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

  return { templatesCreated, templatesSkipped, templatesRefreshed, templatesTotal: TEMPLATES.length, bankUpserted };
}

// Standalone run: `tsx prisma/seed-hiring-templates.ts`
if (process.argv[1] && process.argv[1].endsWith("seed-hiring-templates.ts")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await seedHiringTemplates(prisma);
      console.log(`seed-hiring-templates: ${r.templatesCreated} created, ${r.templatesRefreshed} interview templates refreshed, ${r.templatesSkipped} unchanged; ${r.bankUpserted} question-bank items upserted.`);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
