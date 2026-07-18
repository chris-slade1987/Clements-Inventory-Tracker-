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
  branch: string | null; pinned: boolean; published: boolean; publishAt: Date | null; authorName: string | null; createdAt: Date;
}) => ({
  id: p.id, type: p.type, title: p.title, excerpt: p.excerpt,
  hasImage: !!p.imagePath, imageAlt: p.imageAlt, linkUrl: p.linkUrl, hasBody: !!(p.body && p.body.trim()),
  eventDate: p.eventDate, location: p.location, honoreeName: p.honoreeName, branch: p.branch,
  pinned: p.pinned, published: p.published, publishAt: p.publishAt, authorName: p.authorName, createdAt: p.createdAt,
});

/** Promote any scheduled posts whose time has arrived. Cheap, idempotent, and
 *  run on read so no separate cron is required. */
async function promoteDue() {
  await prisma.bulletinPost.updateMany({ where: { published: false, publishAt: { lte: new Date() } }, data: { published: true } });
}

/** The board feed: published only, pinned first, then newest. */
export async function listPosts(opts: { type?: string; limit?: number } = {}) {
  await promoteDue();
  const posts = await prisma.bulletinPost.findMany({
    where: { published: true, ...(opts.type ? { type: opts.type } : {}) },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: opts.limit,
  });
  return posts.map(shape);
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
