import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { canViewExec, isFieldOpsDirector, isSuperAdmin } from "@/lib/auth";
import { branchLabel, BRANCHES } from "@/lib/management";
import { appUrl } from "@/lib/app-url";
import { postSystemThread, branchSupervisorRecipients, type SystemRecipient } from "@/lib/threads";

// ---------------------------------------------------------------------------
// GROUNDWORK — To-Dos + Projects + "My Work" (Round 1-A core lib).
//
// The universal task primitive (WorkItem) everything can be: a personal To-Do,
// a project task, a Huddle follow-up, or an item spun off a record. Assignment,
// due dates, status + priority behave identically everywhere — the "My Work"
// payoff. Ledger discipline: append-only comments, cancel/archive (never
// hard-delete), completeWorkItem stamps completedAt and keeps the row.
//
// Naming (user-facing + code): Groundwork module · To-Dos · The Greenhouse
// (= horizon "someday") · Huddles (meetings, see lib/huddles.ts).
//
// Access scoping (enforced server-side): anyone creates their OWN To-Dos +
// Greenhouse items + projects; assigning to OTHERS is role-gated — a manager
// may assign within their own branch's team, super-admins / leadership to
// anyone. See canAssignToPerson / canAssignToBranch.
// ---------------------------------------------------------------------------

export const WORK_STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const WORK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type WorkPriority = (typeof WORK_PRIORITIES)[number];
export const WORK_HORIZONS = ["now", "week", "someday"] as const;
export type WorkHorizon = (typeof WORK_HORIZONS)[number];

const PRIORITY_RANK: Record<WorkPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const DAY = 864e5;

const isStatus = (v: unknown): v is WorkStatus => typeof v === "string" && (WORK_STATUSES as readonly string[]).includes(v);
const isPriority = (v: unknown): v is WorkPriority => typeof v === "string" && (WORK_PRIORITIES as readonly string[]).includes(v);
const isHorizon = (v: unknown): v is WorkHorizon => typeof v === "string" && (WORK_HORIZONS as readonly string[]).includes(v);

const base = () => appUrl();
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Parse a date-ish input ("YYYY-MM-DD" from a date input, or ISO) → Date | null. */
export function parseWorkDate(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00.000Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Serializable DTOs (dates → ISO) for the server→client boundary ────────────

export type WorkItemCommentDTO = {
  id: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type WorkItemDTO = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  priority: string;
  horizon: string;
  creatorId: string;
  creatorName: string | null;
  assigneeType: string;
  assigneeId: string | null;
  assigneeName: string | null;
  branch: string | null;
  branchLabel: string | null;
  startDate: string | null;
  dueDate: string | null;
  projectId: string | null;
  meetingId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  order: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  comments?: WorkItemCommentDTO[];
};

type WorkItemRow = {
  id: string; title: string; notes: string | null; status: string; priority: string; horizon: string;
  creatorId: string; creatorName: string | null;
  assigneeType: string; assigneeId: string | null; assigneeName: string | null; branch: string | null;
  startDate: Date | null; dueDate: Date | null; projectId: string | null; meetingId: string | null;
  sourceType: string | null; sourceId: string | null; order: number | null;
  completedAt: Date | null; createdAt: Date; updatedAt: Date;
  comments?: { id: string; authorId: string | null; authorName: string | null; body: string; createdAt: Date }[];
};

export function toWorkItemDTO(r: WorkItemRow): WorkItemDTO {
  return {
    id: r.id, title: r.title, notes: r.notes, status: r.status, priority: r.priority, horizon: r.horizon,
    creatorId: r.creatorId, creatorName: r.creatorName,
    assigneeType: r.assigneeType, assigneeId: r.assigneeId, assigneeName: r.assigneeName,
    branch: r.branch, branchLabel: r.branch ? branchLabel(r.branch) : null,
    startDate: iso(r.startDate), dueDate: iso(r.dueDate),
    projectId: r.projectId, meetingId: r.meetingId, sourceType: r.sourceType, sourceId: r.sourceId,
    order: r.order, completedAt: iso(r.completedAt), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    comments: r.comments?.map((c) => ({ id: c.id, authorId: c.authorId, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString() })),
  };
}

// ── Access scoping ────────────────────────────────────────────────────────────

/** Leadership = anyone who may assign To-Dos to ANYONE, any branch. Super
 *  admins, senior leadership, HR, exec viewers, and the Dir. of Field Ops. */
export function isGroundworkLeadership(user: SessionUser): boolean {
  return (
    isSuperAdmin(user) ||
    canViewExec(user) ||
    !!user.seniorLeadership ||
    !!user.hrAccess ||
    isFieldOpsDirector(user)
  );
}

/**
 * May `user` assign a To-Do to the person `targetUserId`?
 *   - To THEMSELVES — always.
 *   - Leadership — anyone.
 *   - A branch MANAGER — anyone whose home branch matches theirs (their team).
 *   - Everyone else — only themselves.
 * Resolves the target's branch from the User table. Server-enforced.
 */
export async function canAssignToPerson(user: SessionUser, targetUserId: string): Promise<boolean> {
  if (!targetUserId || targetUserId === user.id) return true;
  if (isGroundworkLeadership(user)) return true;
  if (user.role === "manager" && user.branch) {
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { branch: true } });
    return !!target && target.branch === user.branch;
  }
  return false;
}

/** May `user` assign a To-Do to a whole BRANCH team? Leadership → any branch; a
 *  branch manager → only their own branch. */
export function canAssignToBranch(user: SessionUser, branch: string): boolean {
  if (!branch) return false;
  if (isGroundworkLeadership(user)) return true;
  return user.role === "manager" && user.branch === branch;
}

// ── Assignment notification (Inbox + email amplifier) ─────────────────────────

/** Resolve a login id → a notifiable recipient (Inbox + best email). */
async function userRecipient(userId: string): Promise<SystemRecipient | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, employeeId: true, active: true } });
  if (!u || !u.active) return null;
  return { userId: u.id, employeeId: u.employeeId, name: u.name, email: u.email };
}

/**
 * Notify the assignee of a To-Do/follow-up when it's assigned to someone OTHER
 * than the creator. Routes through the Inbox spine (`postSystemThread`) which
 * also fans out the email amplifier. Best-effort — a notification must never
 * block the save. For a branch assignment, the branch's supervisors are notified.
 */
export async function notifyAssignment(item: {
  id: string; title: string; assigneeType: string; assigneeId: string | null; assigneeName: string | null;
  creatorId: string; creatorName: string | null; branch: string | null; dueDate: Date | null;
  fromMeeting?: boolean;
}): Promise<void> {
  try {
    let recipients: SystemRecipient[] = [];
    if (item.assigneeType === "person" && item.assigneeId) {
      if (item.assigneeId === item.creatorId) return; // self-assigned — no notice
      const r = await userRecipient(item.assigneeId);
      if (r) recipients = [r];
    } else if (item.assigneeType === "branch" && item.branch) {
      recipients = await branchSupervisorRecipients(item.branch, item.creatorId);
    }
    if (recipients.length === 0) return;

    const by = item.creatorName ? `${item.creatorName} ` : "";
    const due = item.dueDate ? ` Due ${item.dueDate.toLocaleDateString()}.` : "";
    const lead = item.fromMeeting ? "a Huddle follow-up" : "a To-Do";
    const subject = item.fromMeeting ? `Follow-up for you: ${item.title}` : `New To-Do for you: ${item.title}`;
    const body =
      `${by}assigned you ${lead} in Groundwork: "${item.title}".${due}\n\n` +
      `Open My Work to see it with everything else on your plate.`;
    await postSystemThread({
      subject,
      body,
      recipients,
      contextType: "reminder",
      contextLabel: item.title,
      contextHref: "/groundwork",
      branch: item.branch,
      authorName: "Buzz",
    });
  } catch (err) {
    console.error(`[groundwork.notifyAssignment] ${item.id} failed:`, err);
  }
}

// ── To-Do CRUD ────────────────────────────────────────────────────────────────

export type CreateWorkItemInput = {
  title: string;
  notes?: string | null;
  priority?: string | null;
  horizon?: string | null;
  status?: string | null;
  assigneeType?: string | null; // "person" | "branch"
  assigneeId?: string | null; // User.id (person) or branch key (branch)
  branch?: string | null;
  startDate?: unknown;
  dueDate?: unknown;
  projectId?: string | null;
  meetingId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  order?: number | null;
};

/**
 * Create a To-Do (or Greenhouse item when horizon="someday"). Access-scoped:
 * the creator may always assign to themselves; assigning to another person /
 * branch is role-gated (see canAssignToPerson / canAssignToBranch) and throws on
 * violation. When assigned to someone else, notifies them (Inbox + email).
 */
export async function createWorkItem(
  user: SessionUser,
  input: CreateWorkItemInput,
  opts: { preauthorizedAssigneeIds?: string[] } = {},
): Promise<WorkItemDTO> {
  const preauth = new Set(opts.preauthorizedAssigneeIds ?? []);
  const title = (input.title ?? "").trim().slice(0, 300);
  if (!title) throw new Error("Give the To-Do a title.");

  const horizon: WorkHorizon = isHorizon(input.horizon) ? input.horizon : "now";
  const priority: WorkPriority = isPriority(input.priority) ? input.priority : "normal";
  const status: WorkStatus = isStatus(input.status) ? input.status : "todo";

  // Resolve assignment + enforce scoping.
  let assigneeType = input.assigneeType === "branch" ? "branch" : "person";
  let assigneeId: string | null = input.assigneeId ?? null;
  let assigneeName: string | null = null;
  let branch: string | null = input.branch ?? null;

  if (assigneeType === "branch") {
    const b = assigneeId || branch;
    if (!b || !BRANCHES.some((x) => x.key === b)) throw new Error("Pick a branch to assign to.");
    if (!canAssignToBranch(user, b)) throw new Error("You can't assign To-Dos to that branch.");
    assigneeId = b;
    branch = b;
    assigneeName = branchLabel(b);
  } else {
    // Person assignment. Default to the creator when unset.
    if (!assigneeId) assigneeId = user.id;
    if (assigneeId !== user.id) {
      if (!preauth.has(assigneeId) && !(await canAssignToPerson(user, assigneeId))) throw new Error("You can only assign To-Dos to your own team.");
      const target = await prisma.user.findUnique({ where: { id: assigneeId }, select: { name: true, branch: true } });
      if (!target) throw new Error("That person no longer has an account.");
      assigneeName = target.name;
      if (!branch) branch = target.branch;
    } else {
      assigneeName = user.name;
      if (!branch) branch = user.branch;
    }
  }

  const row = await prisma.workItem.create({
    data: {
      title,
      notes: (input.notes ?? "").toString().trim().slice(0, 5000) || null,
      status,
      priority,
      horizon,
      creatorId: user.id,
      creatorName: user.name,
      assigneeType,
      assigneeId,
      assigneeName,
      branch,
      startDate: parseWorkDate(input.startDate),
      dueDate: parseWorkDate(input.dueDate),
      projectId: input.projectId ?? null,
      meetingId: input.meetingId ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      order: typeof input.order === "number" && Number.isFinite(input.order) ? Math.round(input.order) : null,
    },
  });

  // Notify when assigned to someone other than the creator (Inbox + email).
  const assignedElsewhere = (assigneeType === "person" && assigneeId !== user.id) || assigneeType === "branch";
  if (assignedElsewhere) {
    await notifyAssignment({
      id: row.id, title: row.title, assigneeType: row.assigneeType, assigneeId: row.assigneeId,
      assigneeName: row.assigneeName, creatorId: row.creatorId, creatorName: row.creatorName,
      branch: row.branch, dueDate: row.dueDate, fromMeeting: !!row.meetingId,
    });
  }

  return toWorkItemDTO(row);
}

/** Who may edit / act on a To-Do: its creator, its assignee (person), a manager
 *  of its branch, or leadership. */
export async function canEditWorkItem(user: SessionUser, item: { creatorId: string; assigneeType: string; assigneeId: string | null; branch: string | null }): Promise<boolean> {
  if (item.creatorId === user.id) return true;
  if (item.assigneeType === "person" && item.assigneeId === user.id) return true;
  if (isGroundworkLeadership(user)) return true;
  if (user.role === "manager" && user.branch && item.branch === user.branch) return true;
  return false;
}

export type UpdateWorkItemInput = Partial<CreateWorkItemInput> & { status?: string | null };

/**
 * Update a To-Do's editable fields. Re-enforces assignment scoping when the
 * assignee changes, and notifies a newly-assigned person/branch. Setting
 * status→done stamps completedAt (use completeWorkItem for that intent); other
 * statuses clear it. Never hard-deletes.
 */
export async function updateWorkItem(user: SessionUser, id: string, input: UpdateWorkItemInput): Promise<WorkItemDTO> {
  const existing = await prisma.workItem.findUnique({ where: { id } });
  if (!existing) throw new Error("That To-Do no longer exists.");
  if (!(await canEditWorkItem(user, existing))) throw new Error("You can't edit that To-Do.");

  const data: Record<string, unknown> = {};
  if (typeof input.title === "string") {
    const t = input.title.trim().slice(0, 300);
    if (!t) throw new Error("Give the To-Do a title.");
    data.title = t;
  }
  if (input.notes !== undefined) data.notes = (input.notes ?? "").toString().trim().slice(0, 5000) || null;
  if (isPriority(input.priority)) data.priority = input.priority;
  if (isHorizon(input.horizon)) data.horizon = input.horizon;
  if (input.startDate !== undefined) data.startDate = parseWorkDate(input.startDate);
  if (input.dueDate !== undefined) data.dueDate = parseWorkDate(input.dueDate);
  if (input.projectId !== undefined) data.projectId = input.projectId ?? null;
  if (typeof input.order === "number" && Number.isFinite(input.order)) data.order = Math.round(input.order);

  if (isStatus(input.status)) {
    data.status = input.status;
    data.completedAt = input.status === "done" ? (existing.completedAt ?? new Date()) : null;
  }

  // Re-assignment (scoped + notify on change to someone else).
  let notifyNew = false;
  if (input.assigneeType !== undefined || input.assigneeId !== undefined) {
    const nextType = (input.assigneeType ?? existing.assigneeType) === "branch" ? "branch" : "person";
    let nextId = input.assigneeId !== undefined ? input.assigneeId : existing.assigneeId;
    if (nextType === "branch") {
      const b = nextId || existing.branch;
      if (!b || !BRANCHES.some((x) => x.key === b)) throw new Error("Pick a branch to assign to.");
      if (!canAssignToBranch(user, b)) throw new Error("You can't assign To-Dos to that branch.");
      data.assigneeType = "branch"; data.assigneeId = b; data.assigneeName = branchLabel(b); data.branch = b;
      notifyNew = existing.assigneeType !== "branch" || existing.assigneeId !== b;
    } else {
      if (!nextId) nextId = user.id;
      if (nextId !== user.id && !(await canAssignToPerson(user, nextId))) throw new Error("You can only assign To-Dos to your own team.");
      const target = await prisma.user.findUnique({ where: { id: nextId }, select: { name: true, branch: true } });
      if (!target) throw new Error("That person no longer has an account.");
      data.assigneeType = "person"; data.assigneeId = nextId; data.assigneeName = target.name;
      if (input.branch === undefined && !existing.branch) data.branch = target.branch;
      notifyNew = (existing.assigneeType !== "person" || existing.assigneeId !== nextId) && nextId !== user.id;
    }
  }
  if (input.branch !== undefined && data.branch === undefined) data.branch = input.branch ?? null;

  const row = await prisma.workItem.update({ where: { id }, data });

  if (notifyNew) {
    await notifyAssignment({
      id: row.id, title: row.title, assigneeType: row.assigneeType, assigneeId: row.assigneeId,
      assigneeName: row.assigneeName, creatorId: row.creatorId, creatorName: row.creatorName,
      branch: row.branch, dueDate: row.dueDate, fromMeeting: !!row.meetingId,
    });
  }
  return toWorkItemDTO(row);
}

/** Mark a To-Do done — stamps completedAt, keeps the row (never deletes). */
export async function completeWorkItem(user: SessionUser, id: string, done = true): Promise<WorkItemDTO> {
  const existing = await prisma.workItem.findUnique({ where: { id } });
  if (!existing) throw new Error("That To-Do no longer exists.");
  if (!(await canEditWorkItem(user, existing))) throw new Error("You can't change that To-Do.");
  const row = await prisma.workItem.update({
    where: { id },
    data: done ? { status: "done", completedAt: existing.completedAt ?? new Date() } : { status: "todo", completedAt: null },
  });
  return toWorkItemDTO(row);
}

/** Cancel (archive) a To-Do — reversible soft close, never a hard delete. */
export async function cancelWorkItem(user: SessionUser, id: string, cancelled = true): Promise<WorkItemDTO> {
  const existing = await prisma.workItem.findUnique({ where: { id } });
  if (!existing) throw new Error("That To-Do no longer exists.");
  if (!(await canEditWorkItem(user, existing))) throw new Error("You can't change that To-Do.");
  const row = await prisma.workItem.update({
    where: { id },
    data: { status: cancelled ? "cancelled" : "todo", completedAt: null },
  });
  return toWorkItemDTO(row);
}

/** Append a comment / work note to a To-Do's activity log (append-only). */
export async function addWorkItemComment(user: SessionUser, workItemId: string, body: string): Promise<WorkItemCommentDTO | null> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { creatorId: true, assigneeType: true, assigneeId: true, branch: true } });
  if (!item) throw new Error("That To-Do no longer exists.");
  if (!(await canEditWorkItem(user, item))) throw new Error("You can't comment on that To-Do.");
  const text = (body ?? "").trim().slice(0, 4000);
  if (!text) return null;
  const c = await prisma.workItemComment.create({
    data: { workItemId, authorId: user.id, authorName: user.name, body: text },
  });
  await prisma.workItem.update({ where: { id: workItemId }, data: { updatedAt: new Date() } }).catch(() => {});
  return { id: c.id, authorId: c.authorId, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString() };
}

/** One To-Do with its activity log, if the user may see it. */
export async function getWorkItem(user: SessionUser, id: string): Promise<WorkItemDTO | null> {
  const row = await prisma.workItem.findUnique({ where: { id }, include: { comments: { orderBy: { createdAt: "asc" } } } });
  if (!row) return null;
  if (!(await canEditWorkItem(user, row))) return null;
  return toWorkItemDTO(row);
}

// ── My Work (the unified inbox) ───────────────────────────────────────────────

export type MyWorkGroupKey = "overdue" | "today" | "week" | "upcoming" | "someday";
export type MyWork = {
  overdue: WorkItemDTO[];
  today: WorkItemDTO[];
  week: WorkItemDTO[];
  upcoming: WorkItemDTO[];
  someday: WorkItemDTO[]; // The Greenhouse
  counts: Record<MyWorkGroupKey, number>;
  total: number;
};

function sortWork(a: WorkItemDTO, b: WorkItemDTO): number {
  const p = PRIORITY_RANK[(a.priority as WorkPriority) ?? "normal"] - PRIORITY_RANK[(b.priority as WorkPriority) ?? "normal"];
  if (p !== 0) return p;
  const ad = a.dueDate ? Date.parse(a.dueDate) : Infinity;
  const bd = b.dueDate ? Date.parse(b.dueDate) : Infinity;
  if (ad !== bd) return ad - bd;
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

/**
 * Every OPEN To-Do the user owns or is assigned (person or their branch),
 * grouped Overdue · Today · This week · Upcoming · Someday and sorted by
 * priority then soonest due. Done + cancelled items are excluded. Someday =
 * The Greenhouse (horizon "someday").
 */
export async function listMyWork(user: SessionUser, now: Date = new Date()): Promise<MyWork> {
  const rows = await prisma.workItem.findMany({
    where: {
      status: { notIn: ["done", "cancelled"] },
      OR: [
        { creatorId: user.id },
        { assigneeType: "person", assigneeId: user.id },
        ...(user.branch ? [{ assigneeType: "branch", assigneeId: user.branch }] : []),
      ],
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayEnd = new Date(todayStart.getTime() + DAY);
  const weekEnd = new Date(todayStart.getTime() + 7 * DAY);

  const groups: Record<MyWorkGroupKey, WorkItemDTO[]> = { overdue: [], today: [], week: [], upcoming: [], someday: [] };
  for (const r of rows) {
    const dto = toWorkItemDTO(r);
    if (r.horizon === "someday") { groups.someday.push(dto); continue; }
    if (r.dueDate) {
      const t = r.dueDate.getTime();
      if (t < todayStart.getTime()) groups.overdue.push(dto);
      else if (t < todayEnd.getTime()) groups.today.push(dto);
      else if (t < weekEnd.getTime()) groups.week.push(dto);
      else groups.upcoming.push(dto);
    } else {
      // No due date: place by horizon so active work still surfaces.
      if (r.horizon === "now") groups.today.push(dto);
      else if (r.horizon === "week") groups.week.push(dto);
      else groups.upcoming.push(dto);
    }
  }
  for (const k of Object.keys(groups) as MyWorkGroupKey[]) groups[k].sort(sortWork);

  const counts = {
    overdue: groups.overdue.length, today: groups.today.length, week: groups.week.length,
    upcoming: groups.upcoming.length, someday: groups.someday.length,
  };
  return { ...groups, counts, total: rows.length };
}

/**
 * Normalized attention rows for the unified Needs-attention model: the user's
 * assigned/own To-Dos that are OVERDUE, due TODAY, or due SOON (within 3 days).
 * Returned as plain records the attention source maps to AttentionItem. Someday
 * items never nudge. Kept here (not in needs-attention.ts) so Groundwork owns
 * its own read; the source in lib/needs-attention.ts normalizes these.
 */
export type GroundworkTodoAttention = {
  id: string; title: string; dueDate: Date | null; branch: string | null;
  bucket: "overdue" | "today" | "soon"; priority: string;
};

export async function attentionTodosForUser(user: SessionUser, now: Date = new Date()): Promise<GroundworkTodoAttention[]> {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const soonEnd = new Date(todayStart.getTime() + 3 * DAY); // through end of +3d window
  const rows = await prisma.workItem.findMany({
    where: {
      status: { notIn: ["done", "cancelled"] },
      horizon: { not: "someday" },
      dueDate: { not: null, lt: soonEnd },
      OR: [
        { creatorId: user.id },
        { assigneeType: "person", assigneeId: user.id },
        ...(user.branch ? [{ assigneeType: "branch", assigneeId: user.branch }] : []),
      ],
    },
    orderBy: [{ dueDate: "asc" }],
    select: { id: true, title: true, dueDate: true, branch: true, priority: true },
  });
  const todayEnd = new Date(todayStart.getTime() + DAY);
  return rows.map((r) => {
    const t = r.dueDate!.getTime();
    const bucket: GroundworkTodoAttention["bucket"] = t < todayStart.getTime() ? "overdue" : t < todayEnd.getTime() ? "today" : "soon";
    return { id: r.id, title: r.title, dueDate: r.dueDate, branch: r.branch, bucket, priority: r.priority };
  });
}

// ── Assignable people (for the UI pickers) ─────────────────────────────────────

export type AssignablePerson = { id: string; name: string; email: string; branch: string | null; branchLabel: string | null };

/**
 * People `user` may assign a To-Do / follow-up to, add as a Huddle attendee, or
 * send a project to — scoped exactly like the server-side assignment guards:
 *   - Leadership → every active login.
 *   - A branch manager → their own branch's active team.
 *   - Everyone else → just themselves.
 * The caller themselves is always first. Used only to populate the pickers; the
 * real guard still runs on every write (canAssignToPerson / canAssignToBranch).
 */
export async function assignablePeople(user: SessionUser): Promise<AssignablePerson[]> {
  const toDTO = (u: { id: string; name: string; email: string; branch: string | null }): AssignablePerson => ({
    id: u.id, name: u.name, email: u.email, branch: u.branch, branchLabel: u.branch ? branchLabel(u.branch) : null,
  });

  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, name: true, email: true, branch: true } });
  const self = me ? [toDTO(me)] : [];

  let others: AssignablePerson[] = [];
  if (isGroundworkLeadership(user)) {
    const rows = await prisma.user.findMany({
      where: { active: true, id: { not: user.id } },
      select: { id: true, name: true, email: true, branch: true },
      orderBy: [{ name: "asc" }],
    });
    others = rows.map(toDTO);
  } else if (user.role === "manager" && user.branch) {
    const rows = await prisma.user.findMany({
      where: { active: true, branch: user.branch, id: { not: user.id } },
      select: { id: true, name: true, email: true, branch: true },
      orderBy: [{ name: "asc" }],
    });
    others = rows.map(toDTO);
  }
  return [...self, ...others];
}

// ── Projects ──────────────────────────────────────────────────────────────────

export type ProjectDTO = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  ownerName: string | null;
  status: string;
  dueDate: string | null;
  branch: string | null;
  branchLabel: string | null;
  color: string | null;
  createdAt: string;
  members?: { id: string; userId: string; role: string }[];
  progress?: { total: number; done: number; pct: number };
};

type ProjectRow = {
  id: string; name: string; description: string | null; ownerId: string; ownerName: string | null;
  status: string; dueDate: Date | null; branch: string | null; color: string | null; createdAt: Date;
  members?: { id: string; userId: string; role: string }[];
  workItems?: { status: string }[];
};

export function toProjectDTO(r: ProjectRow): ProjectDTO {
  const items = r.workItems ?? [];
  const live = items.filter((w) => w.status !== "cancelled");
  const done = live.filter((w) => w.status === "done").length;
  const progress = { total: live.length, done, pct: live.length ? Math.round((done / live.length) * 100) : 0 };
  return {
    id: r.id, name: r.name, description: r.description, ownerId: r.ownerId, ownerName: r.ownerName,
    status: r.status, dueDate: iso(r.dueDate), branch: r.branch, branchLabel: r.branch ? branchLabel(r.branch) : null,
    color: r.color, createdAt: r.createdAt.toISOString(),
    members: r.members?.map((m) => ({ id: m.id, userId: m.userId, role: m.role })),
    progress: r.workItems ? progress : undefined,
  };
}

/** Create a project. Anyone may create one; the creator is its owner + an
 *  owner-role member. */
export async function createProject(user: SessionUser, input: { name: string; description?: string | null; dueDate?: unknown; branch?: string | null; color?: string | null }): Promise<ProjectDTO> {
  const name = (input.name ?? "").trim().slice(0, 200);
  if (!name) throw new Error("Give the project a name.");
  const row = await prisma.project.create({
    data: {
      name,
      description: (input.description ?? "").toString().trim().slice(0, 5000) || null,
      ownerId: user.id,
      ownerName: user.name,
      dueDate: parseWorkDate(input.dueDate),
      branch: input.branch ?? user.branch ?? null,
      color: input.color ?? null,
      members: { create: { userId: user.id, role: "owner" } },
    },
    include: { members: true, workItems: { select: { status: true } } },
  });
  return toProjectDTO(row);
}

/** Who may manage a project (edit, add members, assign its tasks): the owner,
 *  an owner/member role on it, or leadership. */
export async function canManageProject(user: SessionUser, project: { ownerId: string; members?: { userId: string; role: string }[] }): Promise<boolean> {
  if (project.ownerId === user.id) return true;
  if (isGroundworkLeadership(user)) return true;
  const m = project.members?.find((x) => x.userId === user.id);
  return !!m && (m.role === "owner" || m.role === "member");
}

export async function updateProject(user: SessionUser, id: string, input: { name?: string; description?: string | null; status?: string | null; dueDate?: unknown; branch?: string | null; color?: string | null }): Promise<ProjectDTO> {
  const existing = await prisma.project.findUnique({ where: { id }, include: { members: true } });
  if (!existing) throw new Error("That project no longer exists.");
  if (!(await canManageProject(user, existing))) throw new Error("You can't edit that project.");
  const data: Record<string, unknown> = {};
  if (typeof input.name === "string") { const n = input.name.trim().slice(0, 200); if (!n) throw new Error("Give the project a name."); data.name = n; }
  if (input.description !== undefined) data.description = (input.description ?? "").toString().trim().slice(0, 5000) || null;
  if (typeof input.status === "string" && ["active", "on_hold", "done", "cancelled"].includes(input.status)) data.status = input.status;
  if (input.dueDate !== undefined) data.dueDate = parseWorkDate(input.dueDate);
  if (input.branch !== undefined) data.branch = input.branch ?? null;
  if (input.color !== undefined) data.color = input.color ?? null;
  const row = await prisma.project.update({ where: { id }, data, include: { members: true, workItems: { select: { status: true } } } });
  return toProjectDTO(row);
}

/**
 * Add a member to a project ("send to people"). Only a project manager may add,
 * and the actor must be allowed to assign to that person (branch scoping) unless
 * the person is merely a viewer. Idempotent on (projectId, userId) — updates the
 * role if they're already on. Notifies the added person via the Inbox.
 */
export async function addProjectMember(user: SessionUser, projectId: string, userId: string, role: "owner" | "member" | "viewer" = "member"): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { members: true } });
  if (!project) throw new Error("That project no longer exists.");
  if (!(await canManageProject(user, project))) throw new Error("You can't manage that project.");
  if (role !== "viewer" && userId !== user.id && !(await canAssignToPerson(user, userId))) {
    throw new Error("You can only add your own team as working members.");
  }
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, employeeId: true, active: true } });
  if (!target) throw new Error("That person no longer has an account.");
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId, role },
    update: { role },
  });
  if (userId !== user.id && target.active) {
    try {
      await postSystemThread({
        subject: `Added to a project: ${project.name}`,
        body: `${user.name} added you to the Groundwork project "${project.name}"${role === "viewer" ? " (view only)" : ""}. Open Groundwork to see the project and your tasks.`,
        recipients: [{ userId: target.id, employeeId: target.employeeId, name: target.name, email: target.email }],
        contextType: "general",
        contextLabel: project.name,
        contextHref: "/groundwork/projects",
        branch: project.branch,
        authorName: "Buzz",
      });
    } catch (err) {
      console.error(`[groundwork.addProjectMember] notify ${projectId} failed:`, err);
    }
  }
}

/** Remove a member from a project (not a hard business record — membership is
 *  operational). The owner can't be removed. */
export async function removeProjectMember(user: SessionUser, projectId: string, userId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { members: true } });
  if (!project) throw new Error("That project no longer exists.");
  if (!(await canManageProject(user, project))) throw new Error("You can't manage that project.");
  if (project.ownerId === userId) throw new Error("The project owner can't be removed.");
  await prisma.projectMember.deleteMany({ where: { projectId, userId } });
}

/** Projects the user owns, is a member of, or (for leadership) all active ones. */
export async function listProjects(user: SessionUser): Promise<ProjectDTO[]> {
  const where = isGroundworkLeadership(user)
    ? {}
    : { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] };
  const rows = await prisma.project.findMany({
    where,
    include: { members: true, workItems: { select: { status: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(toProjectDTO);
}

/** One project with members + its To-Dos (if the user may see it). */
export async function getProject(user: SessionUser, id: string): Promise<{ project: ProjectDTO; items: WorkItemDTO[] } | null> {
  const row = await prisma.project.findUnique({ where: { id }, include: { members: true, workItems: { include: { comments: { orderBy: { createdAt: "asc" } } }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] } } });
  if (!row) return null;
  const isMember = row.ownerId === user.id || row.members.some((m) => m.userId === user.id);
  if (!isMember && !isGroundworkLeadership(user)) return null;
  const items = row.workItems.map(toWorkItemDTO);
  return { project: toProjectDTO({ ...row, workItems: row.workItems.map((w) => ({ status: w.status })) }), items };
}
