import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/app-url";
import { branchLabel } from "@/lib/management";
import { postSystemThread, employeeRecipient, type SystemRecipient } from "@/lib/threads";
import { matchBranchManagerEmployee } from "@/lib/scorecard";
import type { SessionUser } from "@/lib/auth";

// Inline coaching threads on manager scorecards (CanopyOS vision Theme 6 —
// Accountability). A durable, in-portal coaching log on a manager's quarterly
// scorecard, mirroring the proven SalesFocusComment pattern (lib/sales-focus.ts).
// The reviewer/coach and the scored branch manager post notes; a new note fires
// an Inbox notification (email as amplifier) via lib/threads.postSystemThread.
//
// The thread is anchored to the ScorecardReview (one coaching log per scorecard
// period), created on demand on the first comment so a coach can start the log
// while the scorecard is still a draft.

/** Serializable coaching comment (dates → ISO) for the "use client" thread. */
export type ScorecardCommentDTO = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
};

/**
 * Who may READ / POST to a scorecard's coaching log:
 *   - any admin (super admin or team-scoped admin) — the reviewers/coaches,
 *   - the branch's own manager (branch-locked to this branch) — the scored person.
 * Branch-locked managers are already pinned to their own branch on the scorecard
 * pages; this guards the API so a manager can't coach on another branch's card.
 */
export function canAccessScorecardCoaching(
  user: Pick<SessionUser, "role" | "branch">,
  branch: string,
): boolean {
  if (user.role === "admin") return true;
  if (user.role === "manager" && user.branch === branch) return true;
  return false;
}

/** This scorecard's coaching log, oldest first. Empty when no review exists yet. */
export async function listScorecardComments(year: number, quarter: number, branch: string): Promise<ScorecardCommentDTO[]> {
  const review = await prisma.scorecardReview.findUnique({
    where: { year_quarter_branch: { year, quarter, branch } },
    select: { comments: { orderBy: { createdAt: "asc" } } },
  });
  if (!review) return [];
  return review.comments.map((c) => ({ id: c.id, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString() }));
}

/** Get-or-create the review document for a period (the coaching-thread anchor). */
async function getOrCreateReview(year: number, quarter: number, branch: string) {
  const existing = await prisma.scorecardReview.findUnique({ where: { year_quarter_branch: { year, quarter, branch } } });
  if (existing) return existing;
  return prisma.scorecardReview.create({ data: { year, quarter, branch } });
}

/**
 * Append a coaching note to a scorecard's log and fire an Inbox notification
 * (with email amplifier) to the OTHER participants — the scored branch manager
 * and the admin reviewers/coaches, minus the author. Best-effort notify: a
 * failed notification never fails the save. Returns the created comment (or null
 * for an empty body).
 */
export async function addScorecardComment(
  opts: { year: number; quarter: number; branch: string; body: string; author: Pick<SessionUser, "id" | "name"> },
): Promise<{ id: string } | null> {
  const text = opts.body.trim().slice(0, 4000);
  if (!text) return null;

  const review = await getOrCreateReview(opts.year, opts.quarter, opts.branch);
  const comment = await prisma.scorecardComment.create({
    data: { reviewId: review.id, authorUserId: opts.author.id, authorName: opts.author.name.slice(0, 200) || "Someone", body: text },
  });
  // Touch the review so recently-coached scorecards surface as updated.
  await prisma.scorecardReview.update({ where: { id: review.id }, data: { updatedAt: new Date() } }).catch(() => {});

  await notifyScorecardComment({ ...opts, body: text }).catch(() => {});
  return { id: comment.id };
}

/** Notify the scored manager + admin coaches (excluding the author) of a new note. */
async function notifyScorecardComment(opts: {
  year: number; quarter: number; branch: string; body: string; author: Pick<SessionUser, "id" | "name">;
}) {
  const recipients: SystemRecipient[] = [];

  // The scored branch manager (their Inbox + email).
  const mgr = await matchBranchManagerEmployee(opts.branch);
  if (mgr) {
    const r = await employeeRecipient(mgr.id);
    if (r) recipients.push(r);
  }

  // Admin reviewers / coaches (super admins + team-scoped admins).
  const admins = await prisma.user.findMany({
    where: { active: true, role: "admin" },
    select: { id: true, name: true, email: true, employeeId: true },
  });
  for (const a of admins) recipients.push({ userId: a.id, employeeId: a.employeeId, name: a.name, email: a.email });

  // Never notify the author of their own note.
  const others = recipients.filter((r) => r.userId !== opts.author.id);
  if (others.length === 0) return;

  const b = branchLabel(opts.branch);
  const label = `Q${opts.quarter} ${opts.year} ${b} scorecard`;
  const href = `/my-branch/scorecard?year=${opts.year}&quarter=${opts.quarter}&branch=${opts.branch}`;
  const link = `${appUrl()}${href}`;
  const subject = `New coaching note on the ${label}`;
  const body = `${opts.author.name} added a coaching note on the ${label}:\n\n${opts.body}\n\nOpen the scorecard to read and reply: ${link}`;

  await postSystemThread({
    subject,
    body,
    recipients: others,
    contextType: "general",
    contextLabel: label,
    contextHref: href,
    branch: opts.branch,
    authorName: opts.author.name,
  });
}
