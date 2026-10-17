import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { parseItems, type ChecklistItem } from "@/lib/checklists";
import type { SessionUser } from "@/lib/auth";

// The reusable SOP runner (CanopyOS Theme 2). This EXTENDS the proven checklist
// engine (lib/checklists.ts + the ChecklistTemplate/Completion/Miss models) into
// a general Standard Operating Procedure runner: a versioned template with richer
// step types (check / text / number / photo), a flexible due rule (recurring
// cadence OR ad-hoc assignment / run-on-demand), the same typed-signature
// attestation, and the same append-only accountability trail + auto-filing.
//
// Legacy weekly/monthly checklists keep working unchanged — they are simply
// ChecklistTemplate rows with kind="checklist". SOPs are kind="sop".

export type SopStepType = "check" | "text" | "number" | "photo";

export type SopTemplate = {
  id: string;
  key: string;
  title: string;
  intro: string | null;
  category: string | null;
  version: number;
  active: boolean;
  dueRule: string; // "cadence" | "adhoc"
  cadence: string; // "weekly" | "monthly" | "none"
  steps: ChecklistItem[];
  createdAt: Date;
};

type TemplateRow = {
  id: string; key: string; title: string; intro: string | null; category: string | null;
  version: number; active: boolean; dueRule: string; cadence: string; items: string; createdAt: Date;
};

function toSopTemplate(t: TemplateRow): SopTemplate {
  return {
    id: t.id, key: t.key, title: t.title, intro: t.intro, category: t.category,
    version: t.version, active: t.active, dueRule: t.dueRule, cadence: t.cadence,
    steps: parseItems(t.items), createdAt: t.createdAt,
  };
}

/** Who may MANAGE the SOP library (activate/deactivate + assign to branches):
 *  the CEO/COO (admin), senior leadership, and the Director of Field Operations.
 *  Never a branch manager — they RUN their branch's SOPs, they don't author or
 *  assign them. Mirrors the checklist oversight / field-ops gating. */
export function canManageSops(user: Pick<SessionUser, "role" | "seniorLeadership" | "email">): boolean {
  const fo = (process.env.FIELD_OPS_EMAIL || "gfoster@clementspestcontrol.com").toLowerCase();
  return user.role === "admin" || !!user.seniorLeadership || (user.email ?? "").toLowerCase() === fo;
}

/** Who may RUN + sign an SOP (branch managers for their branch, plus admins). */
export function canRunSop(user: Pick<SessionUser, "role">): boolean {
  return user.role === "manager" || user.role === "admin";
}

// ---- Templates --------------------------------------------------------------

export async function listSopTemplates(opts: { includeInactive?: boolean } = {}): Promise<SopTemplate[]> {
  const rows = await prisma.checklistTemplate.findMany({
    where: { kind: "sop", ...(opts.includeInactive ? {} : { active: true }) },
    orderBy: [{ active: "desc" }, { title: "asc" }],
  });
  return rows.map(toSopTemplate);
}

export async function getSopTemplate(idOrKey: string): Promise<SopTemplate | null> {
  const row =
    (await prisma.checklistTemplate.findFirst({ where: { id: idOrKey, kind: "sop" } })) ??
    (await prisma.checklistTemplate.findFirst({ where: { key: idOrKey, kind: "sop" } }));
  return row ? toSopTemplate(row) : null;
}

// ---- Assignments (the ad-hoc due rule) --------------------------------------

export type SopAssignmentView = {
  id: string;
  templateId: string;
  templateVersion: number;
  templateTitle: string;
  category: string | null;
  branch: string;
  branchLabel: string;
  title: string | null; // per-assignment label override
  dueDate: Date | null;
  overdue: boolean;
  status: string;
  assignedByName: string | null;
  note: string | null;
  createdAt: Date;
};

function overdue(dueDate: Date | null, now: Date): boolean {
  return !!dueDate && dueDate.getTime() < now.getTime();
}

/** Open SOP assignments for a branch (or every branch when `branch` is null),
 *  soonest-due first, then oldest. */
export async function openAssignments(branch: string | null, now: Date = new Date()): Promise<SopAssignmentView[]> {
  const rows = await prisma.sopAssignment.findMany({
    where: { status: "open", ...(branch ? { branch } : {}) },
    include: { template: { select: { title: true, category: true } } },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((a) => ({
    id: a.id,
    templateId: a.templateId,
    templateVersion: a.templateVersion,
    templateTitle: a.template.title,
    category: a.template.category,
    branch: a.branch,
    branchLabel: branchLabel(a.branch),
    title: a.title,
    dueDate: a.dueDate,
    overdue: overdue(a.dueDate, now),
    status: a.status,
    assignedByName: a.assignedByName,
    note: a.note,
    createdAt: a.createdAt,
  }));
}

export async function getAssignment(id: string) {
  return prisma.sopAssignment.findUnique({ where: { id } });
}

// ---- Completions ------------------------------------------------------------

export type SopCompletionView = {
  id: string;
  templateId: string;
  templateTitle: string;
  templateVersion: number;
  branch: string;
  branchLabel: string;
  signedName: string;
  createdAt: Date;
};

/** Recently signed SOP completions for a branch (or company-wide), newest first. */
export async function recentSopCompletions(branch: string | null, take = 20): Promise<SopCompletionView[]> {
  const rows = await prisma.checklistCompletion.findMany({
    where: { cadence: "none", ...(branch ? { branch } : {}), template: { kind: "sop" } },
    include: { template: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((c) => ({
    id: c.id,
    templateId: c.templateId,
    templateTitle: c.template.title,
    templateVersion: c.templateVersion,
    branch: c.branch,
    branchLabel: branchLabel(c.branch),
    signedName: c.signedName,
    createdAt: c.createdAt,
  }));
}

/** Count of open assignments per branch (for the library overview). */
export async function openAssignmentCountByTemplate(): Promise<Record<string, number>> {
  const grouped = await prisma.sopAssignment.groupBy({
    by: ["templateId"],
    where: { status: "open" },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const g of grouped) out[g.templateId] = g._count._all;
  return out;
}

// ---- Period / run keys ------------------------------------------------------
// Ad-hoc SOP completions use a run key that is unique per run so multiple runs
// are always allowed and never collide with the (templateId, branch, periodKey)
// uniqueness that still protects cadence double-signs. A run tied to an
// assignment uses "asg:<id>" so that assignment can be signed exactly once.

export function assignmentPeriodKey(assignmentId: string): string {
  return `asg:${assignmentId}`;
}
export function adHocRunKey(): string {
  return `run:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/** The attestation statement a manager signs when completing an SOP. Stored
 *  verbatim on the completion (same pattern as the checklist attestation). */
export function sopAttestationText(signedName: string, title: string, branch: string): string {
  return `I, ${signedName || "________"}, verify that I personally completed every step of the "${title}" SOP at the ${branchLabel(branch)} branch and that the information I recorded above is accurate.`;
}

// ---- Theme-3 integration helper --------------------------------------------
// A clean, normalized "needs attention" shape the role-command-center / rhythm
// aggregator (Theme 3, owned by another agent) can register as a source without
// reaching into this module's internals. We intentionally do NOT wire this into
// their files — they call this helper.

export type SopAttentionItem = {
  source: "sop";
  id: string; // assignment id
  templateId: string;
  title: string;
  branch: string;
  branchLabel: string;
  dueDate: Date | null;
  overdue: boolean;
  href: string; // deep link straight into the runner for this assignment
};

/**
 * SOPs that need a given user's attention: their branch's OPEN assignments
 * (admins/leadership see every branch). Overdue items sort first. Returns the
 * normalized SopAttentionItem shape so a cross-source aggregator can merge SOPs
 * alongside checklists, inspections, etc.
 */
export async function sopsNeedingAttention(
  user: Pick<SessionUser, "role" | "branch">,
  now: Date = new Date(),
): Promise<SopAttentionItem[]> {
  const branch = user.role !== "admin" && user.branch ? user.branch : null;
  const open = await openAssignments(branch, now);
  return open
    .map((a) => ({
      source: "sop" as const,
      id: a.id,
      templateId: a.templateId,
      title: a.title || a.templateTitle,
      branch: a.branch,
      branchLabel: a.branchLabel,
      dueDate: a.dueDate,
      overdue: a.overdue,
      href: `/sops/${a.templateId}?assignment=${a.id}&branch=${a.branch}`,
    }))
    .sort((x, y) => Number(y.overdue) - Number(x.overdue));
}

/** Convenience used by the runner landing page: every valid branch key. */
export function allBranchKeys(): string[] {
  return BRANCHES.map((b) => b.key);
}
