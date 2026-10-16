"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/format";

// Director-facing "Funnel health" board — a visual, interactive, PACE-AWARE view
// of how each advisor is tracking this far into the month. The headline idea: a
// progress bar toward each advisor's $ goal with an "on-pace" marker placed at
// (month elapsed) — so halfway to goal on the 15th reads instantly as on pace.
// Filter by status, sort by who needs attention, and expand a row for the
// stage-by-stage breakdown + the bottleneck diagnosis. Pure presentational: all
// pace math is computed server-side and passed in (keeps prisma off the client).

type Status = "on" | "watch" | "behind" | "nogoal";
type Stage = { key: string; label: string; actual: number; goal: number; status: Status; pct: number; money?: boolean };
export type HealthRow = {
  id: string; name: string; branch: string | null;
  hasGoal: boolean; hasData: boolean;
  goal: number; closed: number; projected: number;
  goalPct: number; overall: Status;
  stages: Stage[];
  diag: { key: string; label: string; msg: string };
};

const S: Record<Status, { bar: string; text: string; chip: string; dot: string; label: string }> = {
  on:     { bar: "bg-emerald-500", text: "text-emerald-700", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", label: "On pace" },
  watch:  { bar: "bg-amber-500",   text: "text-amber-700",   chip: "bg-amber-50 text-amber-800 border-amber-200",       dot: "bg-amber-500",   label: "Watch" },
  behind: { bar: "bg-red-500",     text: "text-red-700",     chip: "bg-red-50 text-red-700 border-red-200",             dot: "bg-red-500",     label: "Behind" },
  nogoal: { bar: "bg-slate-300",   text: "text-slate-500",   chip: "bg-slate-100 text-slate-600 border-slate-200",      dot: "bg-slate-300",   label: "Needs goal" },
};

const SEVERITY: Record<Status, number> = { behind: 0, watch: 1, on: 2, nogoal: 3 };

type Filter = "all" | Status;

export default function FunnelHealthBoard({
  rows, pace, monthLabel, day, daysInMonth, basePath = "/sales",
}: {
  rows: HealthRow[];
  pace: number; // fraction of the month elapsed (0–1)
  monthLabel: string;
  day: number;
  daysInMonth: number;
  basePath?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const pacePctLabel = Math.round(pace * 100);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { on: 0, watch: 0, behind: 0, nogoal: 0 };
    for (const r of rows) c[r.overall]++;
    return c;
  }, [rows]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => SEVERITY[a.overall] - SEVERITY[b.overall] || a.goalPct - b.goalPct || a.name.localeCompare(b.name)),
    [rows],
  );
  const shown = filter === "all" ? sorted : sorted.filter((r) => r.overall === filter);

  const chips: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "All", n: rows.length },
    { key: "behind", label: "Behind", n: counts.behind },
    { key: "watch", label: "Watch", n: counts.watch },
    { key: "on", label: "On pace", n: counts.on },
    { key: "nogoal", label: "Needs goal", n: counts.nogoal },
  ];

  return (
    <div className="space-y-3">
      {/* Month pace header — frames every bar below. */}
      <div className="rounded-xl border border-line bg-white/60 p-4">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-ink">{monthLabel} · Day {day} of {daysInMonth}</div>
          <div className="text-xs text-muted">{pacePctLabel}% through the month — each advisor should be about here on their goal.</div>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full bg-forest-grad transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pacePctLabel}%` }} />
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filter === c.key ? "border-brand-400 bg-brand-50 text-brand-800" : "border-line bg-white text-ink hover:bg-black/[0.02]"}`}
          >
            {c.key !== "all" ? <span className={`h-2 w-2 rounded-full ${S[c.key as Status].dot}`} /> : null}
            {c.label}
            <span className="tabular-nums text-muted">{c.n}</span>
          </button>
        ))}
      </div>

      {/* Advisor pace rows */}
      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-black/[0.015] px-4 py-6 text-center text-sm text-muted">No advisors in this view.</div>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => {
            const st = S[r.overall];
            const open = openId === r.id;
            const projPctOfGoal = r.goal > 0 ? Math.round((r.projected / r.goal) * 100) : 0;
            return (
              <div key={r.id} className="overflow-hidden rounded-xl border border-line bg-white">
                <button type="button" onClick={() => setOpenId(open ? null : r.id)} aria-expanded={open} className="w-full px-4 py-3 text-left hover:bg-black/[0.015]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-ink">{r.name}</span>
                      {r.branch ? <span className="ml-2 text-[11px] text-muted">{r.branch}</span> : null}
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${st.chip}`}>{st.label}</span>
                  </div>

                  {/* The pace bar with the "on-pace" marker */}
                  {r.hasGoal ? (
                    <div className="mt-2.5">
                      <PaceBar pct={r.goalPct} markerPct={pacePctLabel} barClass={st.bar} />
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px]">
                        <span className="text-muted">
                          <span className={`font-semibold tabular-nums ${st.text}`}>{money(r.closed)}</span> of <span className="tabular-nums text-ink">{money(r.goal)}</span>
                          <span className="text-muted"> · {Math.round(r.goalPct)}% ({pacePctLabel}% expected)</span>
                        </span>
                        <span className="text-muted">Projected <span className="font-semibold tabular-nums text-ink">{money(r.projected)}</span> · <span className={st.text}>{projPctOfGoal}% of goal</span></span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-muted">No goal set for this month — <span className="font-medium text-ink">set one to start tracking pace.</span></div>
                  )}
                </button>

                {/* Expanded: stage-by-stage pace + bottleneck */}
                {open ? (
                  <div className="border-t border-line bg-black/[0.015] px-4 py-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      {r.stages.map((s) => (
                        <div key={s.key}>
                          <div className="mb-1 flex items-center justify-between text-[11px]">
                            <span className="font-medium text-ink">{s.label}</span>
                            <span className={`inline-flex items-center gap-1 ${S[s.status].text}`}><span className={`h-1.5 w-1.5 rounded-full ${S[s.status].dot}`} />{S[s.status].label}</span>
                          </div>
                          <PaceBar pct={s.pct} markerPct={pacePctLabel} barClass={S[s.status].bar} thin />
                          <div className="mt-1 text-[10px] text-muted tabular-nums">
                            {s.money ? money(s.actual) : s.actual} {s.goal > 0 ? <>of {s.money ? money(s.goal) : s.goal}</> : <>· no target</>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${S[r.diag.key as Status]?.chip ?? "border-line"}`}>
                      <span className="font-semibold">{r.diag.label}:</span> <span className="text-ink/80">{r.diag.msg}</span>
                    </div>
                    <div className="mt-3">
                      <Link href={`${basePath}/${r.id}`} className="text-xs font-medium text-brand-700 hover:underline">Open {r.name.split(" ")[0]}&rsquo;s goal sheet →</Link>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-muted">The marker on each bar is where the advisor should be today ({pacePctLabel}% of goal). Past it = ahead of pace, short of it = behind. Tap a row for the stage-by-stage breakdown.</p>
    </div>
  );
}

// A goal-progress bar with a vertical "on-pace" marker at `markerPct`.
function PaceBar({ pct, markerPct, barClass, thin = false }: { pct: number; markerPct: number; barClass: string; thin?: boolean }) {
  const w = Math.max(0, Math.min(100, pct));
  const m = Math.max(0, Math.min(100, markerPct));
  return (
    <div className={`relative ${thin ? "h-2" : "h-3"} w-full overflow-hidden rounded-full bg-black/[0.07]`}>
      <div className={`h-full rounded-full ${barClass} transition-[width] duration-500 motion-reduce:transition-none`} style={{ width: `${w}%` }} />
      {/* on-pace marker */}
      <div className="absolute top-0 bottom-0 w-[2px] bg-forest-ink/70" style={{ left: `calc(${m}% - 1px)` }} aria-hidden />
    </div>
  );
}
