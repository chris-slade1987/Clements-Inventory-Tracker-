import { Card } from "@/components/ui";
import { money, qty } from "@/lib/format";
import type { SourcePerformance } from "@/lib/sales-leads";

// Lead-source performance board: volume + conversion per marketing channel, and
// the company-provided vs. self-generated split. Presentational (no client JS) —
// the page computes the data and passes it in. Renders well on a phone.

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function LeadSourcePerformanceCard({ perf, heading }: { perf: SourcePerformance; heading?: string }) {
  if (perf.totals.total === 0) {
    return (
      <Card className="p-6 text-center">
        <div className="text-sm font-medium text-ink">No lead-source data in this range</div>
        <div className="mt-1 text-xs text-muted">Once leads are logged with a source, channel and provided-vs-self performance will show here.</div>
      </Card>
    );
  }

  const maxValue = Math.max(...perf.sources.map((s) => s.closedValue), 1);
  const prov = perf.buckets.find((b) => b.key === "provided");
  const self = perf.buckets.find((b) => b.key === "self");

  return (
    <div>
      {heading ? <h3 className="mb-2 text-sm font-semibold text-ink">{heading}</h3> : null}

      {/* Company-provided vs self-generated — the key metric */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <BucketTile label="Company-provided" row={prov} tone="brand" />
        <BucketTile label="Self-generated" row={self} tone="emerald" />
      </div>

      {/* Per-channel table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-3 py-2 text-right font-medium">Leads</th>
                <th className="px-3 py-2 text-right font-medium">Closed</th>
                <th className="px-3 py-2 text-right font-medium">Close %</th>
                <th className="px-4 py-2 text-right font-medium">Closed $</th>
              </tr>
            </thead>
            <tbody>
              {perf.sources.map((s) => (
                <tr key={s.key} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 font-medium text-ink">
                      {s.label}
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${s.provided ? "bg-brand-100 text-brand-700" : "bg-emerald-100 text-emerald-700"}`}>{s.provided ? "provided" : "self"}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-black/[0.06]">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((s.closedValue / maxValue) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(s.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(s.closed)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={s.closeRate >= 0.3 ? "font-medium text-emerald-600" : s.closeRate < 0.15 ? "text-amber-600" : "text-muted"}>{pct(s.closeRate)}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{money(s.closedValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line px-4 py-2 text-[11px] text-muted">
          Close rate = closed ÷ total leads for that source. Closed $ is the won value attributed to the source.
        </div>
      </Card>
    </div>
  );
}

function BucketTile({ label, row, tone }: { label: string; row: SourcePerformance["buckets"][number] | undefined; tone: "brand" | "emerald" }) {
  const t = tone === "brand" ? "text-brand-600" : "text-emerald-600";
  return (
    <Card className="p-3">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${t}`}>{row?.total ?? 0}<span className="ml-1 text-sm text-muted">leads</span></div>
      <div className="mt-1 text-xs text-muted">
        {row?.closed ?? 0} closed · <b className="text-ink">{pct(row?.closeRate ?? 0)}</b> close · {money(row?.closedValue ?? 0)}
      </div>
    </Card>
  );
}
