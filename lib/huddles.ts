import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import {
  createWorkItem, toWorkItemDTO, isGroundworkLeadership, parseWorkDate,
  type WorkItemDTO,
} from "@/lib/groundwork";
import { reconcileHuddleEvent, cancelHuddleEvent } from "@/lib/huddle-calendar";
import { notifyHuddleScheduled } from "@/lib/huddle-notify";

// ---------------------------------------------------------------------------
// HUDDLES — meetings with a live agenda (seeded from a template, editable live),
// live notes, and REAL-TIME follow-ups (WorkItems with meetingId set, which land
// on each owner's My Work). A completed Huddle — with its notes + each person's
// follow-ups — is retrievable from every attendee's profile (huddlesForUser).
//
// Google Calendar sync is LIVE when a Workspace service account is configured:
// scheduling a Huddle auto-creates a real Google event on the organizer's calendar,
// invites the domain attendees (Google sends the invite emails), and attaches a
// Google Meet link — kept in sync on update / cancel / attendee changes. All of that
// is in lib/huddle-calendar.ts and is best-effort + NON-FATAL: when calendar isn't
// configured (or the organizer isn't an @clementspestcontrol.com mailbox) it no-ops
// and the .ics / "Add to Google Calendar" fallback (lib/huddle-ics.ts) is used.
// ---------------------------------------------------------------------------

export const MEETING_KINDS = ["sales", "marketing", "ops", "one_on_one", "custom"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];
export const MEETING_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ── DTOs ────────────────────────────────────────────────────────────────────

export type MeetingAttendeeDTO = {
  id: string; userId: string | null; email: string; name: string | null; role: string; response: string | null;
};
export type AgendaItemDTO = { id: string; order: number; title: string; prompt: string | null; done: boolean };
export type MeetingNoteDTO = { id: string; authorId: string | null; authorName: string | null; body: string; createdAt: string };

export type MeetingDTO = {
  id: string;
  title: string;
  kind: string | null;
  organizerId: string;
  organizerName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  location: string | null;
  meetingLink: string | null;
  agendaTemplateId: string | null;
  status: string;
  recurrence: string | null;
  branch: string | null;
  branchLabel: string | null;
  // Live Google Calendar sync (null when not synced — fall back to .ics).
  calendarEventId: string | null;
  calendarMeetLink: string | null;
  calendarHtmlLink: string | null;
  completedAt: string | null;
  createdAt: string;
  attendees?: MeetingAttendeeDTO[];
  agendaItems?: AgendaItemDTO[];
  notes?: MeetingNoteDTO[];
  followUps?: WorkItemDTO[];
};

type MeetingRow = {
  id: string; title: string; kind: string | null; organizerId: string; organizerName: string | null;
  scheduledStart: Date | null; scheduledEnd: Date | null; location: string | null; meetingLink: string | null;
  agendaTemplateId: string | null; status: string; recurrence: string | null; branch: string | null;
  calendarEventId: string | null; calendarMeetLink: string | null; calendarHtmlLink: string | null;
  completedAt: Date | null; createdAt: Date;
  attendees?: { id: string; userId: string | null; email: string; name: string | null; role: string; response: string | null }[];
  agendaItems?: { id: string; order: number; title: string; prompt: string | null; done: boolean }[];
  notes?: { id: string; authorId: string | null; authorName: string | null; body: string; createdAt: Date }[];
  followUps?: Parameters<typeof toWorkItemDTO>[0][];
};

export function toMeetingDTO(r: MeetingRow): MeetingDTO {
  return {
    id: r.id, title: r.title, kind: r.kind, organizerId: r.organizerId, organizerName: r.organizerName,
    scheduledStart: iso(r.scheduledStart), scheduledEnd: iso(r.scheduledEnd), location: r.location, meetingLink: r.meetingLink,
    agendaTemplateId: r.agendaTemplateId, status: r.status, recurrence: r.recurrence,
    branch: r.branch, branchLabel: r.branch ? branchLabel(r.branch) : null,
    calendarEventId: r.calendarEventId, calendarMeetLink: r.calendarMeetLink, calendarHtmlLink: r.calendarHtmlLink,
    completedAt: iso(r.completedAt), createdAt: r.createdAt.toISOString(),
    attendees: r.attendees?.map((a) => ({ id: a.id, userId: a.userId, email: a.email, name: a.name, role: a.role, response: a.response })),
    agendaItems: r.agendaItems?.map((a) => ({ id: a.id, order: a.order, title: a.title, prompt: a.prompt, done: a.done })),
    notes: r.notes?.map((n) => ({ id: n.id, authorId: n.authorId, authorName: n.authorName, body: n.body, createdAt: n.createdAt.toISOString() })),
    followUps: r.followUps?.map(toWorkItemDTO),
  };
}

// ── Access ──────────────────────────────────────────────────────────────────

/** Who may MANAGE a Huddle (edit details, complete, cancel): the organizer or
 *  leadership. */
export function canManageMeeting(user: SessionUser, meeting: { organizerId: string }): boolean {
  return meeting.organizerId === user.id || isGroundworkLeadership(user);
}

/** Who may PARTICIPATE (add notes, agenda items, follow-ups): the organizer, any
 *  attendee with a matching login, or leadership. */
export function canParticipate(user: SessionUser, meeting: { organizerId: string; attendees?: { userId: string | null }[] }): boolean {
  if (canManageMeeting(user, meeting)) return true;
  return !!meeting.attendees?.some((a) => a.userId === user.id);
}

// ── Create + attendees ────────────────────────────────────────────────────────

export type CreateMeetingInput = {
  title: string;
  kind?: string | null;
  scheduledStart?: unknown;
  scheduledEnd?: unknown;
  location?: string | null;
  meetingLink?: string | null;
  branch?: string | null;
  recurrence?: string | null;
  agendaTemplateKey?: string | null; // apply this template's items on create
  attendees?: { userId?: string | null; email?: string | null; name?: string | null }[];
};

/** Create a Huddle. The organizer is added as an attendee (role "organizer").
 *  Optionally seeds the working agenda from a template and adds attendees. */
export async function createMeeting(user: SessionUser, input: CreateMeetingInput): Promise<MeetingDTO> {
  const title = (input.title ?? "").trim().slice(0, 300);
  if (!title) throw new Error("Give the Huddle a title.");
  const kind = typeof input.kind === "string" && (MEETING_KINDS as readonly string[]).includes(input.kind) ? input.kind : null;

  const meeting = await prisma.meeting.create({
    data: {
      title, kind,
      organizerId: user.id, organizerName: user.name,
      scheduledStart: parseWorkDate(input.scheduledStart),
      scheduledEnd: parseWorkDate(input.scheduledEnd),
      location: (input.location ?? "").toString().trim().slice(0, 300) || null,
      meetingLink: (input.meetingLink ?? "").toString().trim().slice(0, 1000) || null,
      branch: input.branch ?? user.branch ?? null,
      recurrence: (input.recurrence ?? "").toString().trim().slice(0, 100) || null,
      attendees: {
        create: { userId: user.id, email: user.email, name: user.name, role: "organizer", response: "accepted" },
      },
    },
  });

  if (input.agendaTemplateKey) await applyAgendaTemplate(meeting.id, input.agendaTemplateKey);
  // Suppress the per-attendee notice here — the single "Huddle scheduled" notice
  // below already covers everyone (organizer + attendees), so we don't double-notify.
  if (input.attendees?.length) await addAttendees(user, meeting.id, input.attendees, { suppressNotify: true });

  // Auto-create the Google Calendar event (+ Meet link, + invite the domain
  // attendees) when calendar is configured, the Huddle has start+end, and the
  // organizer is a domain mailbox. Best-effort + non-fatal — a calendar failure
  // never fails the create; the .ics fallback remains. See lib/huddle-calendar.ts.
  await reconcileHuddleEvent(meeting.id, "full");

  // Canopy's own notice (Inbox + email) to every attendee INCLUDING the organizer —
  // Google never emails the organizer about their own event. Only fires when the
  // Huddle has a scheduled time; best-effort + non-fatal. Runs after the calendar
  // reconcile so the Meet link (if any) is included.
  await notifyHuddleScheduled(meeting.id, "created");

  return getMeeting(user, meeting.id) as Promise<MeetingDTO>;
}

/** Add attendees to a Huddle (idempotent per email). Resolves a login by email
 *  when `userId` isn't supplied so follow-ups can land in their My Work. */
export async function addAttendees(
  user: SessionUser,
  meetingId: string,
  attendees: { userId?: string | null; email?: string | null; name?: string | null }[],
  opts: { suppressNotify?: boolean } = {},
): Promise<void> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { attendees: true } });
  if (!meeting) throw new Error("That Huddle no longer exists.");
  if (!canManageMeeting(user, meeting)) throw new Error("Only the organizer can add attendees.");

  // Remember who was already on the Huddle so we only notify the NEWLY added ones.
  const before = new Set(meeting.attendees.map((a) => a.email.toLowerCase()));
  const addedEmails: string[] = [];

  for (const a of attendees) {
    let email = (a.email ?? "").trim().toLowerCase();
    let userId = a.userId ?? null;
    let name = (a.name ?? "").trim() || null;
    // Resolve a login so follow-ups reach their My Work + the Huddle shows on
    // their profile. By id first, else by email.
    if (userId) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
      if (u) { email = email || u.email.toLowerCase(); name = name || u.name; }
    } else if (email) {
      const u = await prisma.user.findFirst({ where: { email: { equals: email } }, select: { id: true, name: true } });
      if (u) { userId = u.id; name = name || u.name; }
    }
    if (!email) continue; // email is the unique key — skip rows with neither
    if (!before.has(email)) addedEmails.push(email);
    await prisma.meetingAttendee.upsert({
      where: { meetingId_email: { meetingId, email } },
      create: { meetingId, userId, email, name, role: "attendee", response: "none" },
      update: { userId: userId ?? undefined, name: name ?? undefined },
    });
  }

  // If the Huddle already has a synced Google event, patch its attendee list so
  // Google re-invites the new people. Non-fatal; never creates an event here (that
  // happens on create/update when there's a scheduled time).
  await reconcileHuddleEvent(meetingId, "patch-only");

  // Notify only the newly-added attendees (Inbox + email), unless suppressed (e.g.
  // during create, where the "Huddle scheduled" notice already covers everyone).
  if (!opts.suppressNotify && addedEmails.length) {
    await notifyHuddleScheduled(meetingId, "attendees_added", addedEmails);
  }
}

/** Remove an attendee (operational membership — not a business record). The
 *  organizer attendee can't be removed. */
export async function removeAttendee(user: SessionUser, meetingId: string, attendeeId: string): Promise<void> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { attendees: true } });
  if (!meeting) throw new Error("That Huddle no longer exists.");
  if (!canManageMeeting(user, meeting)) throw new Error("Only the organizer can remove attendees.");
  const a = meeting.attendees.find((x) => x.id === attendeeId);
  if (!a) return;
  if (a.role === "organizer") throw new Error("The organizer can't be removed.");
  await prisma.meetingAttendee.delete({ where: { id: attendeeId } });

  // Patch the synced Google event's attendee list so Google uninvites them. Non-fatal.
  await reconcileHuddleEvent(meetingId, "patch-only");
}

// ── Agenda (template apply + live edits) ──────────────────────────────────────

type TemplateItem = { order?: number; title: string; prompt?: string | null };

/** Copy an AgendaTemplate's items into a Huddle's working agenda. Replaces any
 *  existing agenda items (so re-applying a template is clean). Idempotent-safe:
 *  stamps the template id on the meeting. */
export async function applyAgendaTemplate(meetingId: string, templateKey: string): Promise<AgendaItemDTO[]> {
  const tpl = await prisma.agendaTemplate.findUnique({ where: { key: templateKey } });
  if (!tpl) throw new Error("That agenda template doesn't exist.");
  let items: TemplateItem[] = [];
  try {
    const parsed = JSON.parse(tpl.items);
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    items = [];
  }
  await prisma.$transaction([
    prisma.meetingAgendaItem.deleteMany({ where: { meetingId } }),
    prisma.meeting.update({ where: { id: meetingId }, data: { agendaTemplateId: tpl.id } }),
    ...items.map((it, i) =>
      prisma.meetingAgendaItem.create({
        data: {
          meetingId,
          order: typeof it.order === "number" ? it.order : i,
          title: (it.title ?? "").toString().slice(0, 300) || `Item ${i + 1}`,
          prompt: it.prompt ? String(it.prompt).slice(0, 1000) : null,
        },
      }),
    ),
  ]);
  const rows = await prisma.meetingAgendaItem.findMany({ where: { meetingId }, orderBy: { order: "asc" } });
  return rows.map((a) => ({ id: a.id, order: a.order, title: a.title, prompt: a.prompt, done: a.done }));
}

/** Add one agenda item live. */
export async function addAgendaItem(user: SessionUser, meetingId: string, title: string, prompt?: string | null): Promise<AgendaItemDTO> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { attendees: true } });
  if (!meeting) throw new Error("That Huddle no longer exists.");
  if (!canParticipate(user, meeting)) throw new Error("You're not on this Huddle.");
  const t = (title ?? "").trim().slice(0, 300);
  if (!t) throw new Error("Give the agenda item a title.");
  const max = await prisma.meetingAgendaItem.aggregate({ where: { meetingId }, _max: { order: true } });
  const a = await prisma.meetingAgendaItem.create({
    data: { meetingId, order: (max._max.order ?? -1) + 1, title: t, prompt: prompt ? String(prompt).slice(0, 1000) : null },
  });
  return { id: a.id, order: a.order, title: a.title, prompt: a.prompt, done: a.done };
}

/** Edit / check off an agenda item live. */
export async function updateAgendaItem(user: SessionUser, agendaItemId: string, data: { title?: string; prompt?: string | null; done?: boolean }): Promise<AgendaItemDTO> {
  const item = await prisma.meetingAgendaItem.findUnique({ where: { id: agendaItemId }, include: { meeting: { include: { attendees: true } } } });
  if (!item) throw new Error("That agenda item no longer exists.");
  if (!canParticipate(user, item.meeting)) throw new Error("You're not on this Huddle.");
  const patch: Record<string, unknown> = {};
  if (typeof data.title === "string") { const t = data.title.trim().slice(0, 300); if (t) patch.title = t; }
  if (data.prompt !== undefined) patch.prompt = data.prompt ? String(data.prompt).slice(0, 1000) : null;
  if (typeof data.done === "boolean") patch.done = data.done;
  const a = await prisma.meetingAgendaItem.update({ where: { id: agendaItemId }, data: patch });
  return { id: a.id, order: a.order, title: a.title, prompt: a.prompt, done: a.done };
}

// ── Live notes ────────────────────────────────────────────────────────────────

/** Capture a live note during a Huddle (append-only). */
export async function addNote(user: SessionUser, meetingId: string, body: string): Promise<MeetingNoteDTO | null> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { attendees: true } });
  if (!meeting) throw new Error("That Huddle no longer exists.");
  if (!canParticipate(user, meeting)) throw new Error("You're not on this Huddle.");
  const text = (body ?? "").trim().slice(0, 8000);
  if (!text) return null;
  const n = await prisma.meetingNote.create({ data: { meetingId, authorId: user.id, authorName: user.name, body: text } });
  return { id: n.id, authorId: n.authorId, authorName: n.authorName, body: n.body, createdAt: n.createdAt.toISOString() };
}

// ── Follow-ups (the real-time To-Do spun out of a Huddle) ─────────────────────

export type FollowUpInput = {
  title: string;
  notes?: string | null;
  assigneeId?: string | null; // a login id — must be an attendee (or one the actor may assign to)
  horizon?: "now" | "week";
  priority?: string | null;
  dueDate?: unknown;
};

/**
 * Create a real-time Huddle follow-up: a WorkItem with `meetingId` set, assigned
 * to the chosen attendee, horizon now/week, with a due date. It lands on the
 * owner's My Work and is notified via the Inbox. Any ATTENDEE of the Huddle is a
 * valid assignee (the organizer convened them); otherwise normal assignment
 * scoping applies. Defaults the assignee to the actor when unset.
 */
export async function createFollowUp(user: SessionUser, meetingId: string, input: FollowUpInput): Promise<WorkItemDTO> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { attendees: true } });
  if (!meeting) throw new Error("That Huddle no longer exists.");
  if (!canParticipate(user, meeting)) throw new Error("You're not on this Huddle.");

  const assigneeId = input.assigneeId || user.id;
  const horizon = input.horizon === "week" ? "week" : "now";
  // Every attendee with a login is a pre-authorized assignee for a follow-up.
  const preauthorizedAssigneeIds = meeting.attendees.map((a) => a.userId).filter((x): x is string => !!x);

  const dto = await createWorkItem(
    user,
    {
      title: input.title,
      notes: input.notes ?? null,
      assigneeType: "person",
      assigneeId,
      horizon,
      priority: input.priority ?? "normal",
      dueDate: input.dueDate,
      branch: meeting.branch,
      meetingId,
      sourceType: "huddle",
      sourceId: meetingId,
    },
    { preauthorizedAssigneeIds },
  );
  return dto;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export type UpdateMeetingInput = {
  title?: string; kind?: string | null; scheduledStart?: unknown; scheduledEnd?: unknown;
  location?: string | null; meetingLink?: string | null; branch?: string | null; recurrence?: string | null;
  status?: string | null;
};

export async function updateMeeting(user: SessionUser, meetingId: string, input: UpdateMeetingInput): Promise<MeetingDTO> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new Error("That Huddle no longer exists.");
  if (!canManageMeeting(user, meeting)) throw new Error("Only the organizer can edit the Huddle.");
  const data: Record<string, unknown> = {};
  if (typeof input.title === "string") { const t = input.title.trim().slice(0, 300); if (!t) throw new Error("Give the Huddle a title."); data.title = t; }
  if (input.kind !== undefined) data.kind = typeof input.kind === "string" && (MEETING_KINDS as readonly string[]).includes(input.kind) ? input.kind : null;
  if (input.scheduledStart !== undefined) data.scheduledStart = parseWorkDate(input.scheduledStart);
  if (input.scheduledEnd !== undefined) data.scheduledEnd = parseWorkDate(input.scheduledEnd);
  if (input.location !== undefined) data.location = (input.location ?? "").toString().trim().slice(0, 300) || null;
  if (input.meetingLink !== undefined) data.meetingLink = (input.meetingLink ?? "").toString().trim().slice(0, 1000) || null;
  if (input.branch !== undefined) data.branch = input.branch ?? null;
  if (input.recurrence !== undefined) data.recurrence = (input.recurrence ?? "").toString().trim().slice(0, 100) || null;
  if (typeof input.status === "string" && (MEETING_STATUSES as readonly string[]).includes(input.status)) {
    data.status = input.status;
    if (input.status === "completed") data.completedAt = meeting.completedAt ?? new Date();
  }
  await prisma.meeting.update({ where: { id: meetingId }, data });

  // Keep the Google Calendar event in sync. If this update cancels the Huddle,
  // cancel the event (Google notifies attendees). Otherwise re-sync: a full sync
  // (re-send invites) when the time/title/location changed, else create-only so an
  // event missed earlier (e.g. created while calendar was down) gets backfilled
  // without re-inviting on unrelated edits. All non-fatal — never fails the update.
  // Did the scheduled TIME actually move? (a reschedule — re-notify the attendees).
  const startMoved =
    data.scheduledStart !== undefined &&
    (meeting.scheduledStart?.getTime() ?? null) !== ((data.scheduledStart as Date | null)?.getTime() ?? null);
  const endMoved =
    data.scheduledEnd !== undefined &&
    (meeting.scheduledEnd?.getTime() ?? null) !== ((data.scheduledEnd as Date | null)?.getTime() ?? null);
  const timeMoved = startMoved || endMoved;

  if (data.status === "cancelled") {
    await cancelHuddleEvent(meetingId);
  } else {
    const timeOrTitleChanged =
      data.title !== undefined ||
      data.scheduledStart !== undefined ||
      data.scheduledEnd !== undefined ||
      data.location !== undefined;
    await reconcileHuddleEvent(meetingId, timeOrTitleChanged ? "full" : "create-only");

    // A real reschedule → Canopy re-notifies every attendee (incl. the organizer),
    // mirroring the create notice. Only when the time moved to a concrete new value;
    // best-effort + non-fatal. Runs after reconcile so the Meet link is current.
    if (timeMoved) await notifyHuddleScheduled(meetingId, "rescheduled");
  }

  return getMeeting(user, meetingId) as Promise<MeetingDTO>;
}

/** Finish a Huddle: status → completed (+ completedAt). Its notes + each
 *  person's follow-ups remain retrievable from their profile. */
export async function completeMeeting(user: SessionUser, meetingId: string): Promise<MeetingDTO> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new Error("That Huddle no longer exists.");
  if (!canManageMeeting(user, meeting)) throw new Error("Only the organizer can complete the Huddle.");
  await prisma.meeting.update({ where: { id: meetingId }, data: { status: "completed", completedAt: meeting.completedAt ?? new Date() } });
  return getMeeting(user, meetingId) as Promise<MeetingDTO>;
}

/** Cancel a Huddle (never hard-deleted). */
export async function cancelMeeting(user: SessionUser, meetingId: string): Promise<MeetingDTO> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new Error("That Huddle no longer exists.");
  if (!canManageMeeting(user, meeting)) throw new Error("Only the organizer can cancel the Huddle.");
  await prisma.meeting.update({ where: { id: meetingId }, data: { status: "cancelled" } });

  // Cancel the synced Google Calendar event (Google notifies attendees) + clear the
  // stored event id/links. Non-fatal; no-op when there's no synced event.
  await cancelHuddleEvent(meetingId);

  return getMeeting(user, meetingId) as Promise<MeetingDTO>;
}

/**
 * Delete a Huddle that didn't happen — a hard delete, which is allowed here (the
 * "never hard-delete" rule is about STOCK movements / inventory audit rows, not
 * meetings). Guardrails so nothing of substance is lost or orphaned:
 *   - Only the organizer / admin / Groundwork leadership may delete (canManageMeeting).
 *   - If the Huddle has real history — live notes, or open/active follow-ups — we
 *     BLOCK and tell the caller to Cancel it instead (keeps its record intact).
 *   - The Google Calendar event (if any) is cancelled FIRST so the invite is
 *     withdrawn and attendees are notified, then the row is removed.
 * On delete, attendees / agenda items / notes cascade with the Meeting (schema
 * onDelete: Cascade); any leftover (cancelled) follow-up WorkItems are detached
 * (meetingId → null via onDelete: SetNull), so nothing is orphaned.
 */
export async function deleteMeeting(user: SessionUser, meetingId: string): Promise<void> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new Error("That Huddle no longer exists.");
  if (!canManageMeeting(user, meeting)) throw new Error("Only the organizer can delete the Huddle.");

  // Block when the Huddle carries real history — a completed/run Huddle is a record.
  const [noteCount, liveFollowUps] = await Promise.all([
    prisma.meetingNote.count({ where: { meetingId } }),
    prisma.workItem.count({ where: { meetingId, status: { notIn: ["cancelled"] } } }),
  ]);
  if (noteCount > 0 || liveFollowUps > 0) {
    throw new Error("This Huddle has notes or follow-ups — cancel it instead of deleting so its record stays intact.");
  }

  // Withdraw the calendar invite first (Google notifies attendees), then delete.
  await cancelHuddleEvent(meetingId);
  await prisma.meeting.delete({ where: { id: meetingId } });
}

// ── Agenda templates (for the create picker) ──────────────────────────────────

export type AgendaTemplateDTO = { key: string; name: string; kind: string | null; itemCount: number };

/** Active agenda templates, for the "draw down a template" step in Huddle create. */
export async function listAgendaTemplates(): Promise<AgendaTemplateDTO[]> {
  const rows = await prisma.agendaTemplate.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return rows.map((t) => {
    let count = 0;
    try { const p = JSON.parse(t.items); if (Array.isArray(p)) count = p.length; } catch { /* ignore */ }
    return { key: t.key, name: t.name, kind: t.kind, itemCount: count };
  });
}

// ── Reads ─────────────────────────────────────────────────────────────────────

const MEETING_INCLUDE = {
  attendees: { orderBy: { createdAt: "asc" } },
  agendaItems: { orderBy: { order: "asc" } },
  notes: { orderBy: { createdAt: "asc" } },
  followUps: { include: { comments: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } },
} as const;

/** One Huddle in full (agenda + notes + attendees + follow-ups), if the user may
 *  see it (organizer, attendee, or leadership). */
export async function getMeeting(user: SessionUser, meetingId: string): Promise<MeetingDTO | null> {
  const row = await prisma.meeting.findUnique({ where: { id: meetingId }, include: MEETING_INCLUDE });
  if (!row) return null;
  const may = row.organizerId === user.id || row.attendees.some((a) => a.userId === user.id) || isGroundworkLeadership(user);
  if (!may) return null;
  return toMeetingDTO(row as unknown as MeetingRow);
}

/** Huddles the user organizes or attends, newest first (scheduled + past). */
export async function listMyHuddles(user: SessionUser): Promise<MeetingDTO[]> {
  const rows = await prisma.meeting.findMany({
    where: { OR: [{ organizerId: user.id }, { attendees: { some: { userId: user.id } } }] },
    include: { attendees: true, agendaItems: { select: { done: true } }, _count: { select: { followUps: true, notes: true } } },
    orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => toMeetingDTO(r as unknown as MeetingRow));
}

/**
 * A person's Huddle history for their profile: completed/past Huddles they were
 * part of, each with its notes and the follow-ups that person owns — the "the
 * Huddle (with notes + the user's follow-ups) is retrievable from each
 * attendee's profile" accessor.
 */
export async function huddlesForUser(user: SessionUser, aboutUserId?: string): Promise<MeetingDTO[]> {
  const targetId = aboutUserId ?? user.id;
  const rows = await prisma.meeting.findMany({
    where: { OR: [{ organizerId: targetId }, { attendees: { some: { userId: targetId } } }] },
    include: {
      attendees: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "asc" } },
      followUps: {
        where: { OR: [{ assigneeType: "person", assigneeId: targetId }, { creatorId: targetId }] },
        include: { comments: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ scheduledStart: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => toMeetingDTO(r as unknown as MeetingRow));
}

/**
 * Attention rows for the unified Needs-attention model: the user's Huddles
 * happening TODAY, plus OPEN follow-ups the user owns from any Huddle. Returned
 * as plain records the attention source normalizes to AttentionItem.
 */
export type HuddleAttention =
  | { type: "huddle_today"; id: string; title: string; start: Date | null; branch: string | null }
  | { type: "followup_open"; id: string; title: string; meetingId: string; dueDate: Date | null; branch: string | null; overdue: boolean };

export async function attentionHuddlesForUser(user: SessionUser, now: Date = new Date()): Promise<HuddleAttention[]> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 864e5);

  const [todayHuddles, openFollowUps] = await Promise.all([
    prisma.meeting.findMany({
      where: {
        status: { in: ["scheduled", "in_progress"] },
        scheduledStart: { gte: dayStart, lt: dayEnd },
        OR: [{ organizerId: user.id }, { attendees: { some: { userId: user.id } } }],
      },
      select: { id: true, title: true, scheduledStart: true, branch: true },
      orderBy: { scheduledStart: "asc" },
    }),
    prisma.workItem.findMany({
      where: {
        meetingId: { not: null },
        status: { notIn: ["done", "cancelled"] },
        assigneeType: "person",
        assigneeId: user.id,
      },
      select: { id: true, title: true, meetingId: true, dueDate: true, branch: true },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  const out: HuddleAttention[] = [];
  for (const m of todayHuddles) out.push({ type: "huddle_today", id: m.id, title: m.title, start: m.scheduledStart, branch: m.branch });
  for (const f of openFollowUps) {
    out.push({
      type: "followup_open", id: f.id, title: f.title, meetingId: f.meetingId!, dueDate: f.dueDate, branch: f.branch,
      overdue: !!(f.dueDate && f.dueDate.getTime() < dayStart.getTime()),
    });
  }
  return out;
}
