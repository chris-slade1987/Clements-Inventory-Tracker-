import { Card } from "@/components/ui";
import { money, qty } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { advisorStanding, teamFunnel, buildLeaderboards, diagnoseFunnel, salesPace, stageStatus, type StageStatus } from "@/lib/sales-funnel";
import SalesCoachButton from "@/components/SalesCoachButton";
import { AchievementBar, encouragement } from "@/components/motivation";

const STATUS: Record<StageStatus, { bar: string; pill: string; label: string }> = {
  on: { bar: "bg-emerald-500", pill: "bg-emerald-100 text-emerald-700", label: "On track" },
  watch: { bar: "bg-amber-500", pill: "bg-amber-100 text-amber-700", label: "Watch" },
  behind: { bar: "bg-red-500", pill: "bg-red-100 text-red-700", label: "Behind" },
  nogoal: { bar: "bg-slate-300", pill: "bg-slate-100 text-slate-500", label: "No goal" },
};
const TONE: Record<string, string> = { gold: "bg-amber-100 text-amber-800", brand: "bg-brand-100 text-brand-700", emerald: "bg-emerald-100 text-emerald-700", violet: "bg-violet-100 text-violet-700" };
const DIAG: Record<StageStatus, string> = {
  on: "border-emerald-200 bg-emerald-50 text-emerald-800",
  watch: "border-amber-200 bg-amber-50 text-amber-800",
  behind: "border-red-200 bg-red-50 text-red-800",
  nogoal: "border-line bg-black/[0.02] text-muted",
};
const fpct = (n: number) => `${Math.round(n * 100)}%`;

function Stage({ ico, name, actual, goal, fmt, pace }: { ico: string; name: string; actual: number; goal: number; fmt: (n: number) => string; pace: number }) {
  const s = stageStatus(actual, goal, pace);
  const st = STATUS[s];
  const fill = goal > 0 ? Math.min(100, Math.round((actual / goal) * 100)) : 0;
  return (
    <div className="py-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span aria-hidden="true">{ico}</span>
        <span className="text-sm font-medium text-ink">{name}</span>
        <span className="ml-auto text-sm tabular-nums">{fmt(actual)} <span className="text-xs text-muted">/ {fmt(goal)} goal</span></span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${st.pill}`}>{st.label}</span>
      </div>
      <div className="relative h-4 overflow-hidden rounded-md border border-line bg-black/[0.05]">
        <div className={`h-full rounded-l-md ${st.bar}`} style={{ width: `${fill}%` }} />
        <div className="absolute -top-1 -bottom-1 w-0.5" style={{ left: `${Math.round(pace * 100)}%`, backgroundColor: "rgba(11,61,32,.55)" }} title="Today's pace" />
      </div>
    </div>
  );
}

function Conv({ label, rate, target }: { label: string; rate: number; target: number }) {
  const ratio = target > 0 ? rate / target : 1;
  const dot = ratio >= 0.98 ? "bg-emerald-500" : ratio >= 0.85 ? "bg-amber-500" : "bg-red-500";
  const flag = ratio < 0.85 ? "below target" : ratio < 0.98 ? "watch" : "";
  return (
    <div className="flex items-center gap-2 py-1 pl-5 text-xs text-muted">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      {label} <b className="font-medium text-ink">{fpct(rate)}</b> <span>target {fpct(target)}</span>
      {flag ? <span className={`ml-auto font-medium ${ratio < 0.85 ? "text-red-600" : "text-amber-600"}`}>{flag}</span> : null}
    </div>
  );
}

// The advisor's own page: a visual, goal-aware funnel with per-stage pace status,
// conversion health, a plain-English diagnosis of the weak link, badges, ranks,
// and an on-demand AI coach.
export default async function SalesFunnelCard({ advisorEmployeeId, periodKey }: { advisorEmployeeId: string; periodKey: string }) {
  const standing = await advisorStanding(advisorEmployeeId, periodKey);
  const me = standing.me;
  if (!me) return null;
  const pace = salesPace(periodKey);
  const diag = diagnoseFunnel(me, pace);
  const { rows } = await teamFunnel(periodKey, standing.branchKey);
  const closedBoard = buildLeaderboards(rows).closed.filter((r) => r.value > 0).slice(0, 5);
  const branchName = standing.branchKey ? branchLabel(standing.branchKey) : "Company";
  const medal = (r: number) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `${r}.`);
  const r = standing.ranks;

  return (
    <Card className="p-4 mb-5">
      {/* badges */}
      {standing.badges.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {standing.badges.map((b) => (
            <span key={b.label} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[b.tone] ?? TONE.brand}`}>{b.emoji} {b.label}</span>
          ))}
        </div>
      ) : null}

      {/* Attainment — your closed $ against this month's goal, plus each funnel
          stage against its own target. On-brand encouragement ramp (motivation
          kit); the real numbers stay in view. Shown once a goal is set. */}
      {me.goal > 0 ? (
        <div className="mb-4 rounded-xl border border-line bg-brand-50/40 p-3.5">
          <AchievementBar
            label="Goal attainment · closed $"
            value={me.closed}
            target={me.goal}
            caption={`${money(me.closed)} of ${money(me.goal)} · ${encouragement(me.goal > 0 ? (me.closed / me.goal) * 100 : 0)}`}
            size="lg"
            milestones={[{ at: 25 }, { at: 50 }, { at: 75 }]}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <AchievementBar size="sm" label="Leads" value={me.leads} target={me.leadsGoal} caption={`${me.leads} / ${me.leadsGoal || "—"}`} />
            <AchievementBar size="sm" label="Proposals" value={me.proposals} target={me.propGoal} caption={`${me.proposals} / ${me.propGoal || "—"}`} />
            <AchievementBar size="sm" label="Closed $" value={me.closed} target={me.goal} caption={`${money(me.closed)} / ${money(me.goal)}`} />
          </div>
        </div>
      ) : null}

      <div className="mb-2 text-[11px] text-muted">The ▲ marker on each bar is where you should be at today&rsquo;s pace.</div>

      {/* funnel */}
      <div className="rounded-xl border border-line p-3">
        <Stage ico="🧲" name="Leads" actual={me.leads} goal={me.leadsGoal} fmt={qty} pace={pace} />
        <Conv label="Lead → Proposal" rate={me.lpRate} target={me.lpTarget} />
        <Stage ico="🎯" name="Proposals" actual={me.proposals} goal={me.propGoal} fmt={qty} pace={pace} />
        <Conv label="Proposal → Close" rate={me.pcRate} target={me.pcTarget} />
        <Stage ico="💰" name="Closed $" actual={me.closed} goal={me.goal} fmt={money} pace={pace} />
      </div>

      {/* diagnosis */}
      <div className={`mt-3 rounded-xl border p-3 text-sm ${DIAG[diag.key]}`}>
        <b className="font-semibold">{diag.key === "on" ? "✅ " : diag.key === "nogoal" ? "" : "⚠ "}{diag.head}.</b> {diag.msg}
      </div>

      {/* AI coach */}
      <SalesCoachButton scope="advisor" advisorEmployeeId={advisorEmployeeId} periodKey={periodKey} />

      {/* ranks */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <RC k="🚀 Leads" v={me.leads ? `#${r.company.leads}` : "—"} />
        <RC k="🎯 Proposals" v={me.proposals ? `#${r.company.proposals}` : "—"} />
        <RC k="💰 Closed" v={me.closed ? `#${r.company.closed}` : "—"} />
      </div>
      <div className="mt-2 text-[11px] text-muted">
        Company ranks of {r.company.total}. Branch: Leads #{r.branch.leads ?? "—"} · Proposals #{r.branch.proposals ?? "—"} · Closed #{r.branch.closed ?? "—"} of {r.branch.total}.
      </div>

      {/* branch closed leaderboard */}
      {closedBoard.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-line">
          <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{branchName} — closed this month</div>
          <ul className="divide-y divide-line">
            {closedBoard.map((x, i) => {
              const mine = x.advisor.id === advisorEmployeeId;
              return (
                <li key={x.advisor.id} className={`flex items-center gap-3 px-3 py-1.5 text-sm ${mine ? "bg-brand-50 font-medium" : ""}`}>
                  <span className="w-6 text-center text-muted">{medal(i + 1)}</span>
                  <span className="min-w-0 flex-1 truncate">{x.advisor.name}{mine ? " (you)" : ""}</span>
                  <span className="tabular-nums">{money(x.value)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function RC({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-line bg-black/[0.02] p-2">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="text-lg font-light text-ink">{v}</div>
    </div>
  );
}
