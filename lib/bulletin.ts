import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";

// Company bulletin: culture feed (stories / announcements / shoutouts / events)
// plus a cascading company calendar. Read-only for everyone; only explicitly
// granted authors (canPostBulletin) may post or manage the calendar. Birthdays
// and work anniversaries are derived from employee profiles at read time, so
// they light up automatically once the HR data is filled in — gaps just stay
// quiet until then.

export const POST_TYPES = [
  { key: "story", label: "Story", chip: "Story" },
  { key: "announcement", label: "Announcement", chip: "Announcement" },
  { key: "shoutout", label: "Shoutout", chip: "Shoutout" },
  { key: "event", label: "Event", chip: "Event" },
] as const;

export function postTypeLabel(key: string): string {
  return POST_TYPES.find((t) => t.key === key)?.label ?? "Story";
}

export const CALENDAR_KINDS = [
  { key: "holiday", label: "Holiday" },
  { key: "closure", label: "Office closure" },
  { key: "early_release", label: "Early release" },
  { key: "event", label: "Event" },
] as const;

export function calendarKindLabel(key: string): string {
  return CALENDAR_KINDS.find((k) => k.key === key)?.label ?? "Event";
}

/** Only explicitly granted authors may post. (Roles are intentionally NOT a
 *  shortcut here — access is a per-person grant we can change any time.) */
export function canPostBulletin(user: SessionUser): boolean {
  return !!user.canPostBulletin;
}

const DAY = 864e5;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export type BulletinTile = Awaited<ReturnType<typeof listPosts>>[number];

const shape = (p: {
  id: string; type: string; title: string; excerpt: string | null; imagePath: string | null; imageAlt: string | null;
  linkUrl: string | null; body: string | null; eventDate: Date | null; location: string | null; honoreeName: string | null;
  branch: string | null; pinned: boolean; published: boolean; publishAt: Date | null; requireAck: boolean; authorName: string | null; createdAt: Date;
}) => ({
  id: p.id, type: p.type, title: p.title, excerpt: p.excerpt,
  hasImage: !!p.imagePath, imageAlt: p.imageAlt, linkUrl: p.linkUrl, hasBody: !!(p.body && p.body.trim()),
  eventDate: p.eventDate, location: p.location, honoreeName: p.honoreeName, branch: p.branch,
  pinned: p.pinned, published: p.published, publishAt: p.publishAt, requireAck: p.requireAck, authorName: p.authorName, createdAt: p.createdAt,
});

/** Post IDs the user has already acknowledged (for badging tiles). */
export async function myAckedPostIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.bulletinAck.findMany({ where: { userId }, select: { postId: true } });
  return new Set(rows.map((r) => r.postId));
}

/** Count of published, ack-required posts this user hasn't confirmed yet. */
export async function pendingAckCount(userId: string): Promise<number> {
  const [required, acked] = await Promise.all([
    prisma.bulletinPost.findMany({ where: { published: true, requireAck: true }, select: { id: true } }),
    myAckedPostIds(userId),
  ]);
  return required.filter((r) => !acked.has(r.id)).length;
}

/** A user's own acknowledgment of a post (or null). */
export async function myAck(postId: string, userId: string) {
  return prisma.bulletinAck.findUnique({ where: { postId_userId: { postId, userId } } });
}

/** Author view: who has acknowledged a post, and how many of active staff. */
export async function ackSummary(postId: string) {
  const [acks, total] = await Promise.all([
    prisma.bulletinAck.findMany({ where: { postId }, orderBy: { acknowledgedAt: "asc" } }),
    prisma.user.count({ where: { active: true } }),
  ]);
  return { count: acks.length, total, who: acks.map((a) => ({ name: a.userName ?? "—", branch: a.branch, at: a.acknowledgedAt })) };
}

/** Promote any scheduled posts whose time has arrived. Cheap, idempotent, and
 *  run on read so no separate cron is required. */
async function promoteDue() {
  await prisma.bulletinPost.updateMany({ where: { published: false, publishAt: { lte: new Date() } }, data: { published: true } });
}

// Posts stay on the active board for 60 days, then move to the Past bulletin.
// A pinned/featured post stays put no matter its age, and an event whose date is
// still upcoming never ages out early.
export const ACTIVE_DAYS = 60;
function isActive(p: { createdAt: Date; eventDate: Date | null; pinned: boolean }, now: number): boolean {
  if (p.pinned) return true;
  if (p.createdAt.getTime() >= now - ACTIVE_DAYS * DAY) return true;
  if (p.eventDate && p.eventDate.getTime() >= now) return true;
  return false;
}

/** The board feed. scope "active" (default) = last 60 days + pinned + upcoming
 *  events; "past" = everything else. Pinned first, then newest. */
export async function listPosts(opts: { type?: string; limit?: number; scope?: "active" | "past" } = {}) {
  await promoteDue();
  const scope = opts.scope ?? "active";
  const posts = await prisma.bulletinPost.findMany({
    where: { published: true, ...(opts.type ? { type: opts.type } : {}) },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
  const now = Date.now();
  const filtered = posts.filter((p) => (scope === "active" ? isActive(p, now) : !isActive(p, now)));
  return (opts.limit ? filtered.slice(0, opts.limit) : filtered).map(shape);
}

/** How many published posts have aged into the Past bulletin. */
export async function pastCount(): Promise<number> {
  await promoteDue();
  const posts = await prisma.bulletinPost.findMany({ where: { published: true }, select: { createdAt: true, eventDate: true, pinned: true } });
  const now = Date.now();
  return posts.filter((p) => !isActive(p, now)).length;
}

/** Authors' unpublished queue — drafts (no publishAt) and scheduled (future). */
export async function authorQueue() {
  await promoteDue();
  const posts = await prisma.bulletinPost.findMany({
    where: { published: false },
    orderBy: [{ publishAt: "asc" }, { createdAt: "desc" }],
  });
  return posts.map((p) => ({ ...shape(p), body: p.body, scheduled: !!p.publishAt }));
}

export async function postDetail(id: string) {
  return prisma.bulletinPost.findUnique({ where: { id } });
}

// ---- Derived celebrations -------------------------------------------------

export type CelebrationItem = {
  kind: "birthday" | "anniversary";
  date: Date;
  employeeId: string;
  name: string;
  branch: string | null;
  years: number | null; // anniversary years; null for birthdays
};

function nextOccurrence(month: number, day: number, from: Date): Date {
  const y = from.getUTCFullYear();
  let d = new Date(Date.UTC(y, month - 1, day));
  if (d.getTime() < startOfUtcDay(from).getTime()) d = new Date(Date.UTC(y + 1, month - 1, day));
  return d;
}

/** Upcoming birthdays + work anniversaries within `withinDays`, derived from
 *  active employee profiles. Employees missing the data simply don't appear. */
export async function upcomingCelebrations(withinDays = 45, from = new Date()): Promise<CelebrationItem[]> {
  const employees = await prisma.employee.findMany({
    where: { status: "active" },
    select: { id: true, name: true, branch: true, hireDate: true, birthMonth: true, birthDay: true },
  });
  const start = startOfUtcDay(from);
  const end = new Date(start.getTime() + withinDays * DAY);
  const out: CelebrationItem[] = [];

  for (const e of employees) {
    if (e.birthMonth && e.birthDay) {
      const d = nextOccurrence(e.birthMonth, e.birthDay, from);
      if (d <= end) out.push({ kind: "birthday", date: d, employeeId: e.id, name: e.name, branch: e.branch, years: null });
    }
    if (e.hireDate) {
      const h = e.hireDate;
      const d = nextOccurrence(h.getUTCMonth() + 1, h.getUTCDate(), from);
      const years = d.getUTCFullYear() - h.getUTCFullYear();
      if (years >= 1 && d <= end) out.push({ kind: "anniversary", date: d, employeeId: e.id, name: e.name, branch: e.branch, years });
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ---- Cascading calendar feed ----------------------------------------------

export type CalendarItem = {
  id: string;
  source: "event" | "post" | "birthday" | "anniversary";
  kind: string; // holiday | closure | early_release | event | birthday | anniversary
  date: Date;
  endDate: Date | null;
  title: string;
  branch: string | null;
  timeLabel: string | null;
  postId?: string;
  employeeId?: string;
};

/** Merge manual calendar entries, event-type posts, and derived birthdays /
 *  anniversaries into one date-sorted list for the next `days`. */
export async function calendarFeed(days = 60, from = new Date()): Promise<CalendarItem[]> {
  const start = startOfUtcDay(from);
  const end = new Date(start.getTime() + days * DAY);

  const [events, eventPosts, celebrations] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: "asc" } }),
    prisma.bulletinPost.findMany({ where: { published: true, type: "event", eventDate: { gte: start, lte: end } }, orderBy: { eventDate: "asc" } }),
    upcomingCelebrations(days, from),
  ]);

  const items: CalendarItem[] = [
    ...events.map((e) => ({ id: e.id, source: "event" as const, kind: e.kind, date: e.date, endDate: e.endDate, title: e.title, branch: e.branch, timeLabel: e.timeLabel })),
    ...eventPosts.map((p) => ({ id: p.id, source: "post" as const, kind: "event", date: p.eventDate!, endDate: p.eventEnd, title: p.title, branch: p.branch, timeLabel: null, postId: p.id })),
    ...celebrations.map((c) => ({
      id: `${c.kind}-${c.employeeId}`, source: c.kind, kind: c.kind, date: c.date, endDate: null,
      title: c.kind === "birthday" ? `${c.name} — Birthday` : `${c.name} — ${c.years}yr Anniversary`,
      branch: c.branch, timeLabel: null, employeeId: c.employeeId,
    })),
  ];
  return items.sort((a, b) => a.date.getTime() - b.date.getTime());
}
