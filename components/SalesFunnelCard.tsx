import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { money, qty } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { advisorStanding, teamFunnel, buildLeaderboards, diagnoseFunnel, salesPace, stageStatus, type StageStatus, type Badge } from "@/lib/sales-funnel";
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

// Thin line icons (brand kit §6: 24×24, stroke 1.6, round caps, no fill, currentColor).
function Icon({ path, className = "h-4 w-4" }: { path: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
  );
}
const ICONS = {
  leads: <path d="M3 5h18M6 5l5 7v5l2 2v-7l5-7" />,                 // funnel = top of pipeline
  proposals: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>, // document
  closed: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M14.5 9.5c-.6-.8-1.6-1.2-2.6-1.2-1.4 0-2.4.8-2.4 1.9 0 2.6 5 1.4 5 4 0 1.1-1 1.9-2.6 1.9-1.1 0-2.1-.4-2.7-1.2" /></>, // $ in circle
  trophy: <><path d="M8 4h8v4a4 4 0 01-8 0z" /><path d="M8 5H5v2a3 3 0 003 3M16 5h3v2a3 3 0 01-3 3M10 13h4M9 20h6M12 13v3" /></>,
  bolt: <path d="M13 3L5 13h6l-1 8 8-10h-6z" />,
  trendUp: <><path d="M4 18l6-6 4 4 6-7" /><path d="M20 9V5m0 4h-4" /></>,
  star: <path d="M12 4l2.3 4.7 5.2.8-3.8 3.6.9 5.1L12 15.8 7.4 18.2l.9-5.1-3.8-3.6 5.2-.8z" />,
  check: <path d="M5 13l4 4L19 7" />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.3 2.3 4.7-5" /></>,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.5" /></>,
};

function badgeIcon(b: Badge): ReactNode {
  const l = b.label.toLowerCase();
  if (l.includes("closed")) return ICONS.trophy;
  if (l.includes("lead")) return ICONS.bolt;
  if (l.includes("proposal")) return ICONS.proposals;
  if (l.includes("improved")) return ICONS.trendUp;
  return ICONS.star; // "Goal crushed"
}

function Stage({ icon, name, actual, goal, fmt, pace }: { icon: ReactNode; name: string; actual: number; goal: number; fmt: (n: number) => string; pace: number }) {
  const s = stageStatus(actual, goal, pace);
  const st = STATUS[s];
  const fill = goal > 0 ? Math.min(100, Math.round((actual / goal) * 100)) : 0;
  return (
    <div className="py-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-brand-600"><Icon path={icon} /></span>
        <span className="text-sm font-medium text-ink">{name}</span>
        <span className="ml-auto text-sm tabular-nums">{fmt(actual)} <span className="text-xs text-muted">/ {fmt(goal)} goal</span></span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${st.pill}`}>{st.label}</span>
      </div>
      <div className="relative h-4 overflow-hidden rounded-md border border-line bg-black/[0.05]" role="progressbar" aria-valuenow={fill} aria-valuemin={0} aria-valuemax={100} aria-label={`${name} vs goal`}>
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
  const r = standing.ranks;

  return (
    <Card className="mb-5 p-4">
      {/* badges */}
      {standing.badges.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {standing.badges.map((b) => (
            <span key={b.label} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONE[b.tone] ?? TONE.brand}`}>
              <Icon path={badgeIcon(b)} className="h-3.5 w-3.5" /> {b.label}
            </span>
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

      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted">
        <span className="inline-block h-3 w-0.5 rounded bg-[rgba(11,61,32,.55)]" /> The marker on each bar is where you should be at today&rsquo;s pace.
      </div>

      {/* funnel */}
      <div className="rounded-xl border border-line p-3">
        <Stage icon={ICONS.leads} name="Leads" actual={me.leads} goal={me.leadsGoal} fmt={qty} pace={pace} />
        <Conv label="Lead → Proposal" rate={me.lpRate} target={me.lpTarget} />
        <Stage icon={ICONS.proposals} name="Proposals" actual={me.proposals} goal={me.propGoal} fmt={qty} pace={pace} />
        <Conv label="Proposal → Close" rate={me.pcRate} target={me.pcTarget} />
        <Stage icon={ICONS.closed} name="Closed $" actual={me.closed} goal={me.goal} fmt={money} pace={pace} />
      </div>

      {/* diagnosis */}
      <div className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm ${DIAG[diag.key]}`}>
        {diag.key === "nogoal" ? null : <Icon path={diag.key === "on" ? ICONS.checkCircle : ICONS.alert} className="mt-0.5 h-4 w-4 shrink-0" />}
        <span><b className="font-semibold">{diag.head}.</b> {diag.msg}</span>
      </div>

      {/* AI coach */}
      <SalesCoachButton scope="advisor" advisorEmployeeId={advisorEmployeeId} periodKey={periodKey} />

      {/* ranks */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <RC icon={ICONS.bolt} k="Leads" v={me.leads ? `#${r.company.leads}` : "—"} />
        <RC icon={ICONS.proposals} k="Proposals" v={me.proposals ? `#${r.company.proposals}` : "—"} />
        <RC icon={ICONS.closed} k="Closed" v={me.closed ? `#${r.company.closed}` : "—"} />
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
                  <Rank n={i + 1} />
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

// A rank chip — top 3 get a subtle medal tint, the rest a plain number.
function Rank({ n }: { n: number }) {
  const tint = n === 1 ? "bg-amber-100 text-amber-800" : n === 2 ? "bg-slate-200 text-slate-700" : n === 3 ? "bg-orange-100 text-orange-800" : "text-muted";
  return <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ${tint}`}>{n}</span>;
}

function RC({ icon, k, v }: { icon: ReactNode; k: string; v: string }) {
  return (
    <div className="rounded-lg border border-line bg-black/[0.02] p-2">
      <div className="flex items-center justify-center gap-1 text-[11px] text-muted"><span className="text-brand-600"><Icon path={icon} className="h-3.5 w-3.5" /></span>{k}</div>
      <div className="text-lg font-light text-ink">{v}</div>
    </div>
  );
}
