import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { managerReminders, type Reminder } from "@/lib/reminders";
import { inspectionStatus } from "@/lib/inspection";
import { SCORECARD_METRICS, savedResults, weightedScore } from "@/lib/scorecard";

export const dynamic = "force-dynamic";

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function MyBranchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const locked = branchLocked(user);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const quarter = Math.floor((month - 1) / 3) + 1;

  const [reminders, insp, openAlerts] = await Promise.all([
    managerReminders(branch ?? undefined),
    inspectionStatus(year, month, branch ?? undefined),
    prisma.alert.count({ where: { status: "open" } }),
  ]);

  // Scorecard snapshot — current quarter, for the selected branch (or the first
  // branch when viewing all, just to show progress).
  const scBranch = branch ?? BRANCHES[0].key;
  const saved = await savedResults(year, quarter, scBranch);
  const metState = Object.fromEntries(SCORECARD_METRICS.map((m) => [m.key, saved[m.key]?.met ?? null]));
  const scScore = weightedScore(metState);
  const scScored = SCORECARD_METRICS.filter((m) => metState[m.key] != null).length;

  const scopeLabel = branch ? branchLabel(branch) : "All branches";

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name?.split(" ")[0] ?? "Manager"}`}
        subtitle={`${scopeLabel} · ${MONTHS[month]} ${year} — your reminders & responsibilities`}
      />

      {locked ? null : (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <BranchPill href="/my-branch" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <BranchPill key={b.key} href={`/my-branch?branch=${b.key}`} label={b.label} active={branch === b.key} />
          ))}
        </div>
      )}

      {/* Tiles */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Tile
          label="Inspections this month"
          value={`${insp.completed}/${insp.total}`}
          tone={insp.pending > 0 ? "warn" : "good"}
          sub={insp.pending > 0 ? `${insp.pending} outstanding` : "All done"}
          href="/my-branch/inspections"
        />
        <Tile label="Reminders" value={String(reminders.length)} tone={reminders.some((r) => r.severity === "critical") ? "bad" : reminders.length ? "warn" : "good"} sub={reminders.length ? "Need attention" : "All clear"} />
        <Tile label="Open alerts" value={String(openAlerts)} tone={openAlerts ? "warn" : "good"} href="/alerts" />
        <Tile label={`Q${quarter} scorecard`} value={`${scScore}%`} sub={`${scScored}/${SCORECARD_METRICS.length} scored`} href={`/management/scorecards?branch=${scBranch}&year=${year}&quarter=${quarter}`} />
      </div>

      {/* Reminders */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="text-sm font-medium text-ink">Reminders &amp; to-dos</div>
          <div className="text-xs text-muted">{reminders.length} item{reminders.length === 1 ? "" : "s"}</div>
        </div>
        {reminders.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nothing outstanding — you&rsquo;re all caught up. 🎉</p>
        ) : (
          <ul className="divide-y divide-line">
            {reminders.slice(0, 12).map((r, i) => (
              <ReminderRow key={i} r={r} showBranch={branch === null} />
            ))}
          </ul>
        )}
      </Card>

      {/* Responsibilities */}
      <Card className="p-4">
        <div className="text-sm font-medium text-ink mb-1">Monthly responsibilities</div>
        <p className="text-xs text-muted mb-3">These feed your quarterly scorecard. Stay current to protect your score.</p>
        <ul className="space-y-2 text-sm">
          <Responsibility
            done={insp.pending === 0 && insp.total > 0}
            label={`Complete monthly vehicle inspections (${insp.completed}/${insp.total})`}
            href="/my-branch/inspections"
          />
          <Responsibility done={null} label="Warehouse inspection report" href={`/management/scorecards?branch=${scBranch}`} />
          <Responsibility done={null} label="Quality control reports" href={`/management/scorecards?branch=${scBranch}`} />
          <Responsibility done={null} label="Onboarding / CEU training current" href={`/management/scorecards?branch=${scBranch}`} />
        </ul>
      </Card>
    </>
  );
}

function ReminderRow({ r, showBranch }: { r: Reminder; showBranch: boolean }) {
  const dot = r.severity === "critical" ? "bg-red-500" : r.severity === "warning" ? "bg-amber-500" : "bg-brand-400";
  return (
    <li>
      <Link href={r.href} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="flex-1">
          <span className="block text-sm font-medium text-ink">
            {r.title}
            {showBranch && r.branch ? <span className="ml-2 text-[11px] font-normal text-muted">{branchLabel(r.branch)}</span> : null}
          </span>
          <span className="block text-xs text-muted">{r.detail}</span>
        </span>
        <span className="text-muted text-xs mt-0.5">→</span>
      </Link>
    </li>
  );
}

function Responsibility({ done, label, href }: { done: boolean | null; label: string; href: string }) {
  const mark = done === true ? "✓" : done === false ? "○" : "•";
  const color = done === true ? "text-brand-600" : "text-muted";
  return (
    <li className="flex items-center gap-2">
      <span className={`grid h-5 w-5 place-items-center rounded-full text-xs ${done === true ? "bg-brand-100 text-brand-700" : "bg-black/5 text-muted"}`}>{mark}</span>
      <Link href={href} className={`hover:underline ${color}`}>{label}</Link>
    </li>
  );
}

function BranchPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>
      {label}
    </Link>
  );
}

function Tile({ label, value, sub, tone, href }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad"; href?: string }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  const inner = (
    <Card className="p-4 h-full">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
      {sub ? <div className="text-xs text-muted mt-0.5">{sub}</div> : null}
    </Card>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{inner}</Link> : inner;
}
