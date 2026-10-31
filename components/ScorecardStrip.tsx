import Link from "next/link";
import { Card } from "@/components/ui";
import { Gauge } from "@/components/motivation";
import { money, qty } from "@/lib/format";

// Scorecard-front-and-center strip for the Branch KPIs view.
//
// The branch KPIs ARE the manager scorecard inputs — production, margin %, tech-
// wages %, stops, new sales, cancellations, chemical %, attrition rate. This strip
// makes that linkage explicit: it leads the branch dashboard with the current
// quarter's weighted score + bonus and every scorecard metric's actual-vs-target
// and Met / Not status, sourced identically to the scorecard itself (saved Met/Not
// where a reviewer set it, otherwise the system's suggested status). Read-only; the
// formal review + sign-off stays on the scorecard page this links to.
//
// Brand-exact: forest/light, Helvetica Neue 300, thin 1.6 icons, no emoji; status
// colors carry an icon + label (never color alone), per the dataviz status rule.

export type StripMetric = {
  key: string;
  label: string;
  weight: number;
  unit: "usd" | "pct" | "count" | null;
  actual: number | null;
  target: number | null;
  met: boolean | null; // saved ?? suggested
  direction?: "higher" | "lower";
};

export type ScorecardStripData = {
  year: number;
  quarter: number;
  branchLabel: string;
  score: number; // 0–100 weighted
  bonus: number; // $ earned
  pool: number; // $ full pool
  status: "tracking" | "final";
  metrics: StripMetric[];
  href: string;
};

function fmt(v: number | null, unit: StripMetric["unit"]): string {
  if (v == null) return "—";
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit === "count") return qty(Math.round(v));
  return money(v);
}

function StatusChip({ met }: { met: boolean | null }) {
  if (met == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-black/20" aria-hidden="true" />
        Unscored
      </span>
    );
  }
  const color = met ? "#0B7A4B" : "#C0362C";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color, backgroundColor: `${color}14`, border: `1px solid ${color}33` }}
    >
      {met ? (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      )}
      {met ? "Met" : "Not met"}
    </span>
  );
}

export default function ScorecardStrip({ data }: { data: ScorecardStripData }) {
  const { year, quarter, branchLabel, score, bonus, pool, status, metrics, href } = data;
  const weighted = metrics.filter((m) => m.weight > 0);
  const metCount = weighted.filter((m) => m.met === true).length;

  return (
    <Card className="mb-4 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-brand-50/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-brand-700" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span className="text-sm font-medium text-ink">Q{quarter} {year} Manager Scorecard</span>
          <span className="text-sm text-muted">· {branchLabel}</span>
          <span
            className="ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={status === "final" ? { color: "#0B7A4B", backgroundColor: "#0B7A4B14" } : { color: "#8A6D1A", backgroundColor: "#E3B23C1F" }}
          >
            {status === "final" ? "Signed" : "Tracking"}
          </span>
        </div>
        <Link href={href} className="text-xs font-medium text-brand-700 hover:underline">Open scorecard →</Link>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-[220px_1fr]">
        {/* Hero: weighted score + bonus */}
        <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-surface p-3 text-center">
          <Gauge value={score} target={100} size={170} format={(n) => `${Math.round(n)}%`} label={<span className="text-[11px] text-muted">weighted score</span>} />
          <div className="mt-1 text-sm text-ink">
            Bonus tracking <span className="font-semibold tabular-nums">{money(bonus)}</span>
            <span className="text-muted"> of {money(pool)}</span>
          </div>
          <div className="text-[11px] text-muted">{metCount} of {weighted.length} weighted metrics Met</div>
        </div>

        {/* Metric table — the exact scorecard inputs, actual vs target + status */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-3 font-medium">Metric</th>
                <th className="py-1.5 pr-3 text-right font-medium">Actual</th>
                <th className="py-1.5 pr-3 text-right font-medium">Target</th>
                <th className="py-1.5 pr-3 text-right font-medium">Wt</th>
                <th className="py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.key} className="border-t border-line/70">
                  <td className="py-1.5 pr-3 text-ink">{m.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{fmt(m.actual, m.unit)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{fmt(m.target, m.unit)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{m.weight ? `${m.weight}%` : "—"}</td>
                  <td className="py-1.5"><StatusChip met={m.met} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            These are the branch KPIs that drive the manager bonus. Status shows the reviewer&rsquo;s Met/Not where set, otherwise the system&rsquo;s suggestion from the live numbers. Full review and sign-off on the scorecard.
          </p>
        </div>
      </div>
    </Card>
  );
}
