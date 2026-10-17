import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { employeeAssignments, STATUS_LABEL } from "@/lib/training";
import { openReviewsForEmployee, reviewsForReviewer, REVIEW_LABEL } from "@/lib/review";
import { interviewsForUser, hiringResultsForUser, INTERVIEW_TYPE_LABELS } from "@/lib/ats";
import { TECH_ROUTINES, CADENCE_LABEL, isFieldRoutineViewer, type Cadence } from "@/lib/routines";
import { ptoBalance } from "@/lib/pto";
import { unreadCount } from "@/lib/threads";
import { prisma } from "@/lib/prisma";
import { ensureSelfEmployeeLink } from "@/lib/self-link";
import BulletinBanner from "@/components/BulletinBanner";
import Glyph from "@/components/Glyph";
import RhythmRibbon from "@/components/RhythmRibbon";
import { buildEmployeeRhythm } from "@/lib/rhythm";

export const dynamic = "force-dynamic";

const CADENCE_CHIP: Record<Cadence, string> = {
  daily: "bg-emerald-100 text-emerald-800",
  weekly: "bg-sky-100 text-sky-800",
  monthly: "bg-violet-100 text-violet-800",
  quarterly: "bg-amber-100 text-amber-800",
};

function RoutineChecklist() {
  return (
    <Card className="p-0 overflow-hidden mb-5">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div className="text-sm font-medium text-ink">Routine checklist</div>
        <span className="text-[11px] text-muted">Your recurring to-dos</span>
      </div>
      <ul className="divide-y divide-line">
        {TECH_ROUTINES.map((r) => (
          <li key={r.key} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Glyph name={r.icon} className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink">{r.label}</div>
              {r.detail ? <div className="text-xs text-muted">{r.detail}</div> : null}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CADENCE_CHIP[r.cadence]}`}>{CADENCE_LABEL[r.cadence]}</span>
            {r.href ? <Link href={r.href} className="mt-0.5 shrink-0 text-xs font-medium text-brand-700 hover:underline">Open →</Link> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// The Employee Hub landing: a card grid into every self-service area (profile,
// time off, HR, handbook, training, inbox) above the viewer's live open items.
function HubGrid({ ptoLabel, trainingLabel, inboxUnread }: { ptoLabel?: string; trainingLabel?: string; inboxUnread?: number }) {
  const inboxSub = inboxUnread && inboxUnread > 0 ? `${inboxUnread} unread · messages & replies` : "Messages & replies";
  const cards: { href: string; glyph: string; title: string; sub: string; badge?: number }[] = [
    { href: "/me/profile", glyph: "star", title: "My profile", sub: "Record, certifications & documents" },
    { href: "/me/pto", glyph: "calendar", title: "Time off", sub: ptoLabel ?? "Request & track PTO" },
    { href: "/me/hr", glyph: "shield", title: "HR & support", sub: "Message HR or request a meeting" },
    { href: "/resources/handbook", glyph: "award", title: "Handbook & policies", sub: "Read & acknowledge" },
    { href: "/me/training", glyph: "cap", title: "Training & certificates", sub: trainingLabel ?? "Courses & sign-offs" },
    { href: "/inbox", glyph: "megaphone", title: "Inbox", sub: inboxSub, badge: inboxUnread },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
      {cards.map((c) => (
        <Link key={c.href} href={c.href} className="group surface-light flex items-start gap-3 rounded-xl border border-line bg-card-grad p-4 transition-colors hover:border-brand-300">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 group-hover:bg-brand-100">
            <Glyph name={c.glyph} className="h-5 w-5" />
            {c.badge && c.badge > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{c.badge > 99 ? "99+" : c.badge}</span>
            ) : null}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">{c.title}</span>
            <span className="block text-xs text-muted">{c.sub}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export default async function MyWorkPage() {
  const user = await requireUser();
  const employeeId = user.employeeId ?? (await ensureSelfEmployeeLink(user));
  const inboxUnread = await unreadCount(user.id).catch(() => 0);
  if (!employeeId) {
    // Without a linked profile we can't read a field role; gate on access level
    // alone so office/sales logins don't see tech routines.
    const showRoutinesNoProfile = isFieldRoutineViewer({ accessLevel: user.accessLevel });
    return (
      <>
        <PageHeader title="Employee Hub" subtitle="Your self-service home" />
        <BulletinBanner />
        <HubGrid inboxUnread={inboxUnread} />
        {showRoutinesNoProfile ? <RoutineChecklist /> : null}
        <EmptyState title="No personnel profile linked" hint="This login isn't linked to an employee profile, so there's no assigned training to show. Your profile, time off, and certifications will appear here once HR links it." />
      </>
    );
  }

  const [assignments, reviews, conducting, interviews, hiringResults, pto, empMeta] = await Promise.all([
    employeeAssignments(employeeId),
    openReviewsForEmployee(employeeId),
    reviewsForReviewer(user.id),
    interviewsForUser(user.id),
    hiringResultsForUser(user.id),
    ptoBalance(employeeId),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { role: true, division: true } }),
  ]);
  const showRoutines = isFieldRoutineViewer({ accessLevel: user.accessLevel, employeeRole: empMeta?.role, division: empMeta?.division });
  const recentHiringResults = hiringResults.slice(0, 2);
  const open = assignments.filter((a) => a.status !== "completed");
  const completed = assignments.filter((a) => a.status === "completed");
  const reviewsToSign = reviews.filter((r) => !r.employeeSignedAt);
  const now = Date.now();

  const ptoLabel = `${pto.remaining} of ${pto.allowance} days left${pto.pending ? ` · ${pto.pending} pending` : ""}`;
  const trainingLabel = open.length ? `${open.length} open · action needed` : "All caught up";

  // Operating-rhythm ribbon — the employee's recurring routines by cadence plus
  // the personal items due now (unified Theme 3 ribbon).
  const employeeRhythm = buildEmployeeRhythm({
    now: new Date(),
    routines: showRoutines ? TECH_ROUTINES.map((r) => ({ key: r.key, label: r.label, cadence: r.cadence, href: r.href })) : [],
    openTraining: open.length,
    trainingOverdue: open.some((a) => a.dueDate != null && a.dueDate.getTime() < now),
    reviewsToSign: reviewsToSign.length,
    interviews: interviews.length,
  });

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} subtitle="Your Employee Hub" />

      <BulletinBanner />

      <RhythmRibbon segments={employeeRhythm} />

      <HubGrid ptoLabel={ptoLabel} trainingLabel={trainingLabel} inboxUnread={inboxUnread} />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 mb-5">
        <Tile label="Open training" value={String(open.length)} tone={open.length ? "bad" : "good"} sub={open.length ? "Action needed" : "All caught up"} />
        <Tile label="Completed" value={String(completed.length)} tone="good" />
        <Tile label="Assigned total" value={String(assignments.length)} />
      </div>

      {showRoutines ? <RoutineChecklist /> : null}

      {interviews.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5 ring-1 ring-amber-200">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Interview{interviews.length === 1 ? "" : "s"} to complete</div>
          <ul className="divide-y divide-line">
            {interviews.map((iv) => {
              const overdue = iv.scheduledAt ? iv.scheduledAt.getTime() < now : false;
              return (
                <li key={iv.id}>
                  <Link href={`/me/interviews/${iv.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${overdue ? "bg-red-500" : "bg-amber-500"}`} />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-ink">{iv.candidate.name}{iv.candidate.job ? ` — ${iv.candidate.job.title}` : ""}</span>
                      <span className="block text-xs text-muted">
                        {INTERVIEW_TYPE_LABELS[iv.type] ?? iv.type} interview · complete the scorecard
                        {iv.scheduledAt ? ` · ${overdue ? "was" : ""} ${iv.scheduledAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}
                      </span>
                    </span>
                    <span className="text-xs font-medium text-brand-700 mt-0.5">Open &amp; score →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {recentHiringResults.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Hiring result{recentHiringResults.length === 1 ? "" : "s"}</div>
          <ul className="divide-y divide-line">
            {recentHiringResults.map((r) => (
              <li key={r.jobId}>
                <Link href="/me/hiring" className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{r.jobTitle}</span>
                    <span className="block text-xs text-muted">{r.hiredName ? `${r.hiredName} was hired` : "Closed without a hire"} · you interviewed for this role</span>
                  </span>
                  <span className="text-xs font-medium text-brand-700 mt-0.5">My Hiring →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {reviewsToSign.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5 ring-1 ring-amber-200">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Your new-hire review{reviewsToSign.length === 1 ? "" : "s"}</div>
          <ul className="divide-y divide-line">
            {reviewsToSign.map((r) => (
              <li key={r.id}>
                <Link href={`/reviews/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{REVIEW_LABEL[r.type]}</span>
                    <span className="block text-xs text-muted">Review this with your manager, then add your signature · due {r.dueDate.toLocaleDateString()}</span>
                  </span>
                  <span className="text-xs font-medium text-brand-700 mt-0.5">Open &amp; sign →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {conducting.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5 ring-1 ring-amber-200">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">New-hire review{conducting.length === 1 ? "" : "s"} to conduct</div>
          <ul className="divide-y divide-line">
            {conducting.map((r) => (
              <li key={r.id}>
                <Link href={`/reviews/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.dueDate.getTime() < now ? "bg-red-500" : "bg-amber-500"}`} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{r.employee.name} — {REVIEW_LABEL[r.type]}</span>
                    <span className="block text-xs text-muted">
                      {r.status === "pending_approval" ? "Signed — awaiting HR approval" : r.reviewerSignedAt ? "You signed — awaiting employee" : "Complete & sign with the employee"}
                      {` · due ${r.dueDate.toLocaleDateString()}`}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-brand-700 mt-0.5">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className={`p-0 overflow-hidden mb-5 ${open.length ? "ring-1 ring-red-300" : ""}`}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className={`text-sm font-medium ${open.length ? "text-red-600" : "text-ink"}`}>Open items{open.length ? ` · ${open.length}` : ""}</div>
          <Link href="/me/library" className="text-xs font-medium text-brand-700 hover:underline">Lesson library →</Link>
        </div>
        {open.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nothing outstanding — you&rsquo;re all caught up.</p>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((a) => {
              const overdue = a.dueDate && a.dueDate.getTime() < now;
              return (
                <li key={a.id}>
                  <Link href={`/me/training/${a.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-red-50/40">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-red-700">{a.course.title}</span>
                      <span className="block text-xs text-red-500">
                        {STATUS_LABEL[a.status]}
                        {a.dueDate ? ` · ${overdue ? "overdue" : "due"} ${a.dueDate.toLocaleDateString()}` : ""}
                        {a.course.category === "onboarding" ? " · onboarding" : ""}
                      </span>
                    </span>
                    <span className="text-xs font-medium text-red-600 mt-0.5">{a.status === "not_started" ? "Start →" : "Resume →"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {completed.length > 0 ? (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Completed</div>
          <ul className="divide-y divide-line">
            {completed.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 text-sm text-ink">{a.course.title}</span>
                <span className="text-xs text-muted tabular-nums">{a.score}%</span>
                <Link href={`/me/training/${a.id}`} className="text-xs font-medium text-brand-700 hover:underline">Review</Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
      {sub ? <div className="text-xs text-muted mt-0.5">{sub}</div> : null}
    </Card>
  );
}
