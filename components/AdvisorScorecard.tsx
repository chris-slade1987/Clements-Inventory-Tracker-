import { Card } from "@/components/ui";
import { money } from "@/lib/format";
import { Gauge, KpiMeter, encouragement, rankMedal, rampTextColor } from "@/components/motivation";
import type { AdvisorScorecardData, AdvisorScoreMetric } from "@/lib/scorecard-advisor";

// Advisor Scorecard view (CanopyOS Theme 6 — the sales-motivation surface). Pure /
// server-renderable: it draws the composite with the motivation kit (Gauge +
// KpiMeter) and the sanctioned sales-motivation medal (rankMedal). Rendered on
// /me/sales (the advisor) and /sales/[id] (director / super admins). This is the
// one surface where motivation ribbons are allowed (brand kit §1, sales module).

function fmtFor(kind: AdvisorScoreMetric["kind"]): (n: number) => string {
  if (kind === "usd") return (n) => money(n);
  if (kind === "pct") return (n) => `${Math.round(n)}%`;
  return (n) => Math.round(n).toLocaleString();
}

export default function AdvisorScorecard({ data, heading = "Advisor scorecard" }: { data: AdvisorScorecardData; heading?: string }) {
  const { compositePct, metrics, rank, rankOf } = data;
  const medal = rank != null ? rankMedal(rank) : null;
  const meters = metrics.filter((m) => m.kind !== "bool");
  const flags = metrics.filter((m) => m.kind === "bool");

  return (
    <Card className="p-4 mb-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-ink">{heading}</div>
          <p className="text-sm text-muted">Your accountability snapshot for {data.periodLabel} — computed from your live sales ledger.</p>
        </div>
        {rank != null ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
            {medal ? <span aria-hidden className="text-base leading-none">{medal}</span> : null}
            Rank {rank} of {rankOf} <span className="font-light text-muted">· closed $ (company)</span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex items-center gap-4 shrink-0">
          <Gauge value={compositePct ?? 0} target={100} size={180} label="Composite" empty={compositePct == null} />
          <div className="max-w-[12rem]">
            <div className="text-xs uppercase tracking-wider text-muted">Composite score</div>
            <div className="text-sm text-ink">{compositePct == null ? "Awaiting data" : encouragement(compositePct)}</div>
            <p className="mt-1 text-[11px] text-muted">Weighted across the lines below that have data this month.</p>
          </div>
        </div>

        <div className="flex-1 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {meters.map((m) => (
            m.attainment == null ? (
              <AwaitingMeter key={m.key} metric={m} />
            ) : (
              <KpiMeter
                key={m.key}
                label={m.label}
                value={m.value as number}
                target={m.target as number}
                format={fmtFor(m.kind)}
              />
            )
          ))}
        </div>
      </div>

      {flags.length ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          {flags.map((m) => <FlagPill key={m.key} metric={m} />)}
        </div>
      ) : null}

      <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {metrics.map((m) => (
          <div key={m.key} className="flex items-start gap-2 text-[11px] text-muted">
            <dt className="shrink-0 font-medium text-ink">{m.label}:</dt>
            <dd>{m.detail}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** A meter line with no data yet — neutral, never a misleading behind-red. */
function AwaitingMeter({ metric }: { metric: AdvisorScoreMetric }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm font-light text-ink">{metric.label}</span>
        <span className="text-xs tabular-nums text-muted">—</span>
      </div>
      <div className="h-3.5 rounded-full" style={{ background: "rgba(8,37,24,.08)" }} role="progressbar" aria-valuenow={0} aria-valuemin={0} aria-valuemax={100} aria-label={`${metric.label} awaiting data`} />
      <div className="mt-1 text-[11px] text-muted">Awaiting data</div>
    </div>
  );
}

/** A binary "goal set on time" style flag. */
function FlagPill({ metric }: { metric: AdvisorScoreMetric }) {
  const met = metric.attainment == null ? null : metric.attainment >= 1;
  const color = met == null ? "#5C6B62" : met ? "#0E7A3D" : rampTextColor(0);
  const bg = met == null ? "rgba(8,37,24,.05)" : met ? "rgba(21,184,92,.12)" : "rgba(229,72,77,.12)";
  return (
    <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium" style={{ background: bg, color }}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {met == null ? <circle cx="12" cy="12" r="9" /> : met ? <path d="M5 13l4 4L19 7" /> : <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>}
      </svg>
      {metric.label}
    </span>
  );
}
