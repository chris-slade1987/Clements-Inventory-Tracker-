import { Card } from "@/components/ui";
import { money, qty } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { advisorStanding, teamFunnel, buildLeaderboards } from "@/lib/sales-funnel";

const TONE: Record<string, string> = {
  gold: "bg-amber-100 text-amber-800",
  brand: "bg-brand-100 text-brand-700",
  emerald: "bg-emerald-100 text-emerald-700",
  violet: "bg-violet-100 text-violet-700",
};

// The advisor's own competitive view — how they stack up this month. Three funnel
// ranks (branch + company), earned badges, progress to goal, and the branch
// leaderboard with their row highlighted. Motivation only; no comp.
export default async function SalesStandingCard({ advisorEmployeeId, periodKey }: { advisorEmployeeId: string; periodKey: string }) {
  const standing = await advisorStanding(advisorEmployeeId, periodKey);
  const me = standing.me;
  if (!me) return null;

  const { rows } = await teamFunnel(periodKey, standing.branchKey);
  const closedBoard = buildLeaderboards(rows).closed.filter((r) => r.value > 0).slice(0, 5);
  const branchName = standing.branchKey ? branchLabel(standing.branchKey) : "Company";
  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`);

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm font-medium text-ink">How you stack up</div>
        <span className="text-[11px] text-muted">{branchName} · this month</span>
      </div>

      {/* Badges */}
      {standing.badges.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {standing.badges.map((b) => (
            <span key={b.label} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[b.tone] ?? TONE.brand}`}>
              <span>{b.emoji}</span>{b.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* Rank chips — leads / proposals / closed, branch + company */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <RankChip emoji="🚀" label="Leads" value={me.leads} fmt={qty} />
        <RankChip emoji="🎯" label="Proposals" value={me.proposals} fmt={qty} />
        <RankChip emoji="💰" label="Closed" value={me.closed} fmt={money} />
      </div>
      <RankLegend ranks={standing.ranks} />

      {/* Progress to goal */}
      {me.goal > 0 ? (
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-muted mb-1">
            <span>Progress to your ${Math.round(me.goal).toLocaleString()} goal</span>
            <span className="tabular-nums font-medium text-ink">{money(me.closed)} · {Math.round(me.goalPct * 100)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-black/5 overflow-hidden">
            <div className={`h-full rounded-full ${me.goalPct >= 1 ? "bg-emerald-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, Math.round(me.goalPct * 100))}%` }} />
          </div>
        </div>
      ) : null}

      {/* Branch leaderboard (closed $) with you highlighted */}
      {closedBoard.length > 0 ? (
        <div className="rounded-lg border border-line overflow-hidden">
          <div className="px-3 py-2 border-b border-line text-[11px] font-semibold uppercase tracking-wide text-muted">{branchName} — closed this month</div>
          <ul className="divide-y divide-line">
            {closedBoard.map((r) => {
              const mine = r.advisor.id === advisorEmployeeId;
              return (
                <li key={r.advisor.id} className={`flex items-center gap-3 px-3 py-1.5 text-sm ${mine ? "bg-brand-50 font-medium" : ""}`}>
                  <span className="w-6 text-center">{medal(r.rank)}</span>
                  <span className="flex-1 truncate">{r.advisor.name}{mine ? " (you)" : ""}</span>
                  <span className="tabular-nums">{money(r.value)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted">Your results will appear here as the month fills in.</p>
      )}
    </Card>
  );
}

type Ranks = { company: { leads: number | null; proposals: number | null; closed: number | null; total: number }; branch: { leads: number | null; proposals: number | null; closed: number | null; total: number } };

function RankChip({ emoji, label, value, fmt }: { emoji: string; label: string; value: number; fmt: (n: number) => string }) {
  return (
    <div className="rounded-lg border border-line p-2 text-center">
      <div className="text-[11px] text-muted">{emoji} {label}</div>
      <div className="text-lg font-light tabular-nums text-ink">{value ? fmt(value) : "—"}</div>
    </div>
  );
}

function RankLegend({ ranks }: { ranks: Ranks }) {
  const line = (label: string, m: "leads" | "proposals" | "closed") => {
    const b = ranks.branch[m]; const c = ranks.company[m];
    return `${label}: ${b ? `#${b} of ${ranks.branch.total} branch` : "—"}${c ? ` · #${c} of ${ranks.company.total} company` : ""}`;
  };
  return (
    <div className="mb-3 space-y-0.5 text-[11px] text-muted">
      <div>{line("Leads", "leads")}</div>
      <div>{line("Proposals", "proposals")}</div>
      <div>{line("Closed $", "closed")}</div>
    </div>
  );
}
