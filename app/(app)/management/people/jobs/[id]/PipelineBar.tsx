import { PIPELINE_STAGE_FLOW, STAGE_LABELS } from "@/lib/ats";
import { MilestoneStepper, type Step } from "@/components/motivation";

// The candidate pipeline as a connected journey (motivation kit MilestoneStepper)
// rather than loose segments. Each node keeps its live count in the label; the
// earliest stage that still has people waiting is the "current" node (the front
// of the funnel to move), stages ahead of it read as cleared, stages behind as
// upcoming. Excluded candidates are called out separately below.
export default function PipelineBar({
  counts,
  excluded = 0,
}: {
  counts: Record<string, number>;
  excluded?: number;
}) {
  // The front of the funnel: earliest stage that still has people in it.
  const attentionIdx = PIPELINE_STAGE_FLOW.findIndex((s) => (counts[s] ?? 0) > 0);
  const attention = attentionIdx === -1 ? null : PIPELINE_STAGE_FLOW[attentionIdx];

  const steps: Step[] = PIPELINE_STAGE_FLOW.map((stage, i) => {
    const n = counts[stage] ?? 0;
    const state: Step["state"] =
      attentionIdx === -1 ? "todo" : i < attentionIdx ? "done" : i === attentionIdx ? "current" : "todo";
    return { label: `${STAGE_LABELS[stage]} · ${n}`, state };
  });

  return (
    <div className="mb-5">
      <MilestoneStepper steps={steps} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {attention ? (
          <p className="text-xs text-muted">
            <span className="font-medium text-ink">{counts[attention]} waiting at {STAGE_LABELS[attention]}</span> — see the highlighted stage below for the next step.
          </p>
        ) : <span />}
        {excluded > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-100 bg-red-50/60 px-2.5 py-0.5 text-[11px] font-medium text-red-600">
            <span className="tabular-nums">{excluded}</span> excluded · retained archive
          </span>
        ) : null}
      </div>
    </div>
  );
}
