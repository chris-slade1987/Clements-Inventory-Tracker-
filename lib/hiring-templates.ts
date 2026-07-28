import "server-only";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/inspection";
import {
  RATING_SCALE,
  INTERVIEW_TEMPLATE,
  isResponseType,
  type InterviewTemplate,
  type ResponseType,
  type ExtraQuestion,
} from "@/lib/ats-config";
import type { HiringTemplate, HiringTemplateQuestion, Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Editable Hiring Template Library — server-only helpers. Resolves the
// interview / screening template assigned to a job (falling back to the role-
// matched template, then the default, then the legacy const questionnaire),
// converts a DB interview template into the shape the existing scorecard form
// renders, and holds the CRUD used by the HR template editor.
// ---------------------------------------------------------------------------

export type TemplateKind = "interview" | "screening";

/** The role / worker-type keys a template can be assigned to. */
export const ROLE_KEYS = [
  { key: "technician", label: "Pest Technician (field)" },
  { key: "sales", label: "Sales / Service Advisor" },
  { key: "manager", label: "Service / Branch Manager" },
  { key: "csr", label: "Customer Service Rep (in-office)" },
  { key: "any", label: "Any role (general)" },
] as const;

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLE_KEYS.map((r) => [r.key, r.label]));

export function parseRoleKeys(s: string | null | undefined): string[] {
  const arr = parseJson<unknown[]>(s ?? "[]", []);
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
}

/** Best-effort guess of a role key from a job title (for default assignment). */
export function roleKeyForTitle(title: string | null | undefined): string {
  const t = (title ?? "").toLowerCase();
  if (/\b(manager|supervisor|director|lead)\b/.test(t)) return "manager";
  if (/\b(sales|advisor|account|business dev)\b/.test(t)) return "sales";
  if (/\b(csr|customer service|receptionist|office|dispatch|scheduler|call center)\b/.test(t)) return "csr";
  if (/\b(tech|technician|pest|lawn|field|route|applicator|fumigat)\b/.test(t)) return "technician";
  return "any";
}

type TemplateWithQuestions = HiringTemplate & { questions: HiringTemplateQuestion[] };

/**
 * Convert a DB interview template into the InterviewTemplate shape the existing
 * scorecard form + candidate renderer consume. rating_1_5 → competencies,
 * basics_yesno_unsure → basics, text/yes_no → extras. Question ids become the
 * response keys (so responses stay stable across edits).
 */
export function templateToInterviewShape(t: TemplateWithQuestions): InterviewTemplate {
  const questions = [...t.questions].sort((a, b) => a.order - b.order);
  const competencies = questions
    .filter((q) => q.responseType === "rating_1_5")
    .map((q) => ({ key: q.id, label: q.section || "Competency", question: q.text }));
  const basics = questions
    .filter((q) => q.responseType === "basics_yesno_unsure")
    .map((q) => ({ key: q.id, label: q.text }));
  const extras: ExtraQuestion[] = questions
    .filter((q) => q.responseType === "text" || q.responseType === "yes_no")
    .map((q) => ({ key: q.id, label: q.text, responseType: q.responseType as "text" | "yes_no" }));
  return { id: t.id, name: t.name, ratingScale: RATING_SCALE, competencies, basics, extras };
}

/**
 * Resolve the active template of a kind that best fits a job: the explicitly
 * assigned template first, then a role-matched active template, then the
 * default. Returns null if none exists (interview then falls back to the const).
 */
export async function resolveTemplateForJob(
  job: { interviewTemplateId?: string | null; screeningTemplateId?: string | null; title?: string | null } | null,
  kind: TemplateKind,
): Promise<TemplateWithQuestions | null> {
  const assignedId = kind === "interview" ? job?.interviewTemplateId : job?.screeningTemplateId;
  if (assignedId) {
    const t = await prisma.hiringTemplate.findFirst({ where: { id: assignedId, active: true }, include: { questions: true } });
    if (t) return t;
  }
  const roleKey = roleKeyForTitle(job?.title);
  if (roleKey && roleKey !== "any") {
    const candidates = await prisma.hiringTemplate.findMany({ where: { kind, active: true }, include: { questions: true } });
    const match = candidates.find((t) => parseRoleKeys(t.roleKeys).includes(roleKey));
    if (match) return match;
  }
  return prisma.hiringTemplate.findFirst({ where: { kind, active: true, isDefault: true }, include: { questions: true } });
}

/**
 * The interview questionnaire to render/validate for a given interview. Resolves
 * the candidate's job's assigned/role/default interview template; falls back to
 * the legacy hardcoded questionnaire when none is configured (so already-saved
 * scorecards + jobs without a template keep working).
 */
export async function interviewTemplateForCandidate(candidateId: string): Promise<InterviewTemplate> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { job: { select: { interviewTemplateId: true, title: true } } },
  });
  const t = await resolveTemplateForJob(candidate?.job ?? null, "interview");
  return t ? templateToInterviewShape(t) : INTERVIEW_TEMPLATE;
}

/**
 * Pick the right template to RENDER already-saved responses with: prefer the
 * resolved template when its question ids appear in the responses, else fall
 * back to the legacy const template (whose keys the old responses used). This is
 * the "keep already-saved scorecards rendering" guarantee.
 */
export function renderTemplateForResponses(
  resolved: InterviewTemplate,
  responses: { competencies?: Record<string, unknown> } | null | undefined,
): InterviewTemplate {
  const comps = responses?.competencies ?? {};
  const keys = Object.keys(comps);
  if (keys.length === 0) return resolved;
  const resolvedHit = resolved.competencies.some((c) => keys.includes(c.key));
  if (resolvedHit) return resolved;
  const legacyHit = INTERVIEW_TEMPLATE.competencies.some((c) => keys.includes(c.key));
  if (legacyHit) return INTERVIEW_TEMPLATE;
  return resolved;
}

// ---- Listing / CRUD (HR editor) -------------------------------------------

export async function listTemplates(kind?: TemplateKind) {
  return prisma.hiringTemplate.findMany({
    where: kind ? { kind } : undefined,
    orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    include: { _count: { select: { questions: true } } },
  });
}

export async function templateById(id: string) {
  return prisma.hiringTemplate.findUnique({ where: { id }, include: { questions: { orderBy: { order: "asc" } } } });
}

export async function listQuestionBank(kind?: TemplateKind) {
  return prisma.questionBankItem.findMany({
    where: { active: true, ...(kind ? { kind } : {}) },
    orderBy: [{ kind: "asc" }, { category: "asc" }, { text: "asc" }],
  });
}

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

type QuestionInput = { id?: string | null; section?: string | null; text: string; responseType: string; required?: boolean };

function normalizeQuestions(input: unknown): { section: string | null; text: string; responseType: ResponseType; required: boolean }[] {
  if (!Array.isArray(input)) return [];
  const out: { section: string | null; text: string; responseType: ResponseType; required: boolean }[] = [];
  for (const raw of input as QuestionInput[]) {
    const text = str(raw?.text);
    if (!text) continue;
    const rt = isResponseType(raw?.responseType) ? raw.responseType : "text";
    out.push({ section: str(raw?.section), text, responseType: rt, required: !!raw?.required });
  }
  return out;
}

export async function createTemplate(
  data: { kind: string; name: string; description?: string | null; roleKeys?: string[]; isDefault?: boolean; questions?: unknown },
  createdByName: string | null,
) {
  const kind: TemplateKind = data.kind === "screening" ? "screening" : "interview";
  const name = str(data.name);
  if (!name) throw new Error("A template name is required.");
  const roleKeys = Array.isArray(data.roleKeys) ? data.roleKeys.filter((k) => typeof k === "string") : [];
  const questions = normalizeQuestions(data.questions);

  return prisma.$transaction(async (tx) => {
    // A new default demotes any other default of the same kind.
    if (data.isDefault) await tx.hiringTemplate.updateMany({ where: { kind, isDefault: true }, data: { isDefault: false } });
    return tx.hiringTemplate.create({
      data: {
        kind,
        name,
        description: str(data.description),
        roleKeys: JSON.stringify(roleKeys),
        isDefault: !!data.isDefault,
        createdByName,
        questions: { create: questions.map((q, i) => ({ ...q, order: i })) },
      },
      include: { questions: true },
    });
  });
}

export async function updateTemplate(
  id: string,
  data: { name?: string | null; description?: string | null; roleKeys?: string[]; isDefault?: boolean; active?: boolean; questions?: unknown },
) {
  const existing = await prisma.hiringTemplate.findUnique({ where: { id } });
  if (!existing) throw new Error("Template not found.");
  const kind = existing.kind as TemplateKind;

  return prisma.$transaction(async (tx) => {
    const patch: Prisma.HiringTemplateUpdateInput = {};
    if (data.name !== undefined) { const n = str(data.name); if (n) patch.name = n; }
    if (data.description !== undefined) patch.description = str(data.description);
    if (data.roleKeys !== undefined) patch.roleKeys = JSON.stringify((data.roleKeys ?? []).filter((k) => typeof k === "string"));
    if (data.active !== undefined) patch.active = !!data.active;
    if (data.isDefault !== undefined) {
      patch.isDefault = !!data.isDefault;
      if (data.isDefault) await tx.hiringTemplate.updateMany({ where: { kind, isDefault: true, id: { not: id } }, data: { isDefault: false } });
    }
    await tx.hiringTemplate.update({ where: { id }, data: patch });

    // Questions are replaced wholesale when provided (the editor sends the full
    // ordered list). Existing question ids are preserved when passed back so
    // saved responses keyed by them keep resolving.
    if (data.questions !== undefined) {
      const incoming = Array.isArray(data.questions) ? (data.questions as QuestionInput[]) : [];
      const keepIds = incoming.map((q) => str(q?.id)).filter((x): x is string => !!x);
      await tx.hiringTemplateQuestion.deleteMany({ where: { templateId: id, id: { notIn: keepIds.length ? keepIds : ["__none__"] } } });
      let order = 0;
      for (const raw of incoming) {
        const text = str(raw?.text);
        if (!text) continue;
        const rt: ResponseType = isResponseType(raw?.responseType) ? raw.responseType : "text";
        const qid = str(raw?.id);
        const fields = { section: str(raw?.section), text, responseType: rt, required: !!raw?.required, order };
        if (qid) await tx.hiringTemplateQuestion.update({ where: { id: qid }, data: fields }).catch(async () => {
          await tx.hiringTemplateQuestion.create({ data: { ...fields, templateId: id } });
        });
        else await tx.hiringTemplateQuestion.create({ data: { ...fields, templateId: id } });
        order++;
      }
    }
    return tx.hiringTemplate.findUnique({ where: { id }, include: { questions: { orderBy: { order: "asc" } } } });
  });
}

/** Duplicate a template (and its questions) as a fresh, non-default draft. */
export async function duplicateTemplate(id: string, createdByName: string | null) {
  const src = await prisma.hiringTemplate.findUnique({ where: { id }, include: { questions: { orderBy: { order: "asc" } } } });
  if (!src) throw new Error("Template not found.");
  return prisma.hiringTemplate.create({
    data: {
      kind: src.kind,
      name: `${src.name} (copy)`,
      description: src.description,
      roleKeys: src.roleKeys,
      isDefault: false,
      createdByName,
      questions: { create: src.questions.map((q, i) => ({ section: q.section, text: q.text, responseType: q.responseType, required: q.required, order: i })) },
    },
    include: { questions: true },
  });
}

/** Soft-deactivate (never hard-delete authored templates). */
export async function setTemplateActive(id: string, active: boolean) {
  return prisma.hiringTemplate.update({ where: { id }, data: { active } });
}

/** Assign an interview + screening template to a job (either may be null). */
export async function assignJobTemplates(jobId: string, interviewTemplateId: string | null, screeningTemplateId: string | null) {
  return prisma.job.update({
    where: { id: jobId },
    data: { interviewTemplateId: str(interviewTemplateId), screeningTemplateId: str(screeningTemplateId) },
  });
}
