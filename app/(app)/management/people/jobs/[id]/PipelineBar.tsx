import { PIPELINE_STAGE_FLOW, STAGE_LABELS } from "@/lib/ats";

// Presentational funnel across the top of a job container. Each segment shows a
// stage's live count in that stage's color; empty stages are muted. The
// earliest non-empty stage is ringed as the "front of the funnel" that needs
// moving, so HR sees at a glance where people are waiting.
const SEG: Record<string, { on: string; count: string; label: string; ring: string }> = {
  applied: { on: "border-slate-200 bg-slate-50", count: "text-slate-700", label: "text-slate-600", ring: "ring-slate-300" },
  screening: { on: "border-sky-200 bg-sky-50", count: "text-sky-700", label: "text-sky-700", ring: "ring-sky-300" },
  interviewing: { on: "border-amber-200 bg-amber-50", count: "text-amber-700", label: "text-amber-700", ring: "ring-amber-300" },
  ranked: { on: "border-indigo-200 bg-indigo-50", count: "text-indigo-700", label: "text-indigo-700", ring: "ring-indigo-300" },
  selected: { on: "border-emerald-200 bg-emerald-50", count: "text-emerald-700", label: "text-emerald-700", ring: "ring-emerald-300" },
  pre_hire: { on: "border-brand-200 bg-brand-50", count: "text-brand-700", label: "text-brand-700", ring: "ring-brand-300" },
};

export default function PipelineBar({
  counts,
  excluded = 0,
}: {
  counts: Record<string, number>;
  excluded?: number;
}) {
  // The front of the funnel: earliest stage that still has people in it.
  const attention = PIPELINE_STAGE_FLOW.find((s) => (counts[s] ?? 0) > 0) ?? null;

  return (
    <div className="mb-5">
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {PIPELINE_STAGE_FLOW.map((stage, i) => {
          const n = counts[stage] ?? 0;
          const s = SEG[stage];
          const active = n > 0;
          const isAttention = stage === attention;
          return (
            <div key={stage} className="flex items-stretch gap-1">
              <div
                className={`flex min-w-[88px] flex-1 flex-col justify-center rounded-xl border px-3 py-2.5 transition-colors ${
                  active ? s.on : "border-line bg-surface"
                } ${isAttention ? `ring-2 ring-offset-1 ${s.ring}` : ""}`}
              >
                <div className={`text-2xl font-semibold leading-none tabular-nums ${active ? s.count : "text-slate-300"}`}>{n}</div>
                <div className={`mt-1 text-[11px] font-medium leading-tight ${active ? s.label : "text-muted"}`}>{STAGE_LABELS[stage]}</div>
              </div>
              {i < PIPELINE_STAGE_FLOW.length - 1 ? (
                <span className="self-center px-0.5 text-muted" aria-hidden>›</span>
              ) : null}
            </div>
          );
        })}
        {excluded > 0 ? (
          <div className="flex items-stretch gap-1">
            <span className="self-center px-0.5 text-muted" aria-hidden>·</span>
            <div className="flex min-w-[88px] flex-col justify-center rounded-xl border border-red-100 bg-red-50/50 px-3 py-2.5">
              <div className="text-2xl font-semibold leading-none tabular-nums text-red-600">{excluded}</div>
              <div className="mt-1 text-[11px] font-medium leading-tight text-red-600">Excluded</div>
            </div>
          </div>
        ) : null}
      </div>
      {attention ? (
        <p className="mt-2 text-xs text-muted">
          <span className="font-medium text-ink">{counts[attention]} waiting at {STAGE_LABELS[attention]}</span> — see the highlighted stage below for the next step.
        </p>
      ) : null}
    </div>
  );
}
