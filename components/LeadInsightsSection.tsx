import { Card } from "@/components/ui";
import { buildHeatMap, buildSourcePerformance, type DateRange } from "@/lib/sales-leads";
import { smarterLaunchConfigured } from "@/lib/smarterlaunch";
import LeadHeatMap from "@/components/LeadHeatMap";
import LeadRangeControl from "@/components/LeadRangeControl";
import LeadSourcePerformanceCard from "@/components/LeadSourcePerformanceCard";
import SalesInsightButton from "@/components/SalesInsightButton";

// Shared Sales-Team lead section: geographic heat map + lead-source performance,
// each with an on-demand AI insight. Used company-wide on the director `/sales`
// hub and per-advisor on `/me/sales` (and any advisor drill-down). The date-range
// control writes to the URL; the server resolves it and passes `range` in.
//
// When SmarterLaunch is connected the section reads ONLY the real
// (origin="smarterlaunch") leads and the "Load sample data" demo control is hidden
// — demo is replaced by the live feed. When it isn't, it reads every origin and
// keeps today's demo behavior.
export default async function LeadInsightsSection({
  scope, advisorEmployeeId = null, branch = null, range, mapTitle, mapSubtitle,
}: {
  scope: "team" | "advisor";
  advisorEmployeeId?: string | null;
  branch?: string | null;
  range: DateRange;
  mapTitle: string;
  mapSubtitle: string;
}) {
  const live = smarterLaunchConfigured();
  const filter = { range, branch: scope === "team" ? branch : null, advisorEmployeeId, origin: live ? "smarterlaunch" : null };
  const [heat, perf] = await Promise.all([buildHeatMap(filter), buildSourcePerformance(filter)]);

  return (
    <section className="mb-8">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{mapTitle}</h2>
        <span className="text-xs text-muted">{range.label}</span>
      </div>
      <p className="mb-3 text-xs text-muted">{mapSubtitle}</p>

      <LeadRangeControl preset={range.preset} from={range.from} to={range.to} />

      {/* Geographic heat map */}
      <Card className="mb-4 p-4">
        <LeadHeatMap clusters={heat.clusters} totals={heat.totals} canLoadDemo={scope === "team" && !live} />
        <SalesInsightButton kind="heatmap" scope={scope} advisorEmployeeId={advisorEmployeeId ?? undefined} branch={branch} range={range.preset} from={range.from} to={range.to} />
      </Card>

      {/* Lead-source performance */}
      <div className="mb-1 text-sm font-semibold text-ink">Lead source performance</div>
      <p className="mb-2 text-xs text-muted">
        {scope === "team" ? "Which sources produce the best leads across the company" : "Which sources work best for you"} — volume, close rate, and company-provided vs. self-generated.
      </p>
      <LeadSourcePerformanceCard perf={perf} />
      <SalesInsightButton kind="sources" scope={scope} advisorEmployeeId={advisorEmployeeId ?? undefined} branch={branch} range={range.preset} from={range.from} to={range.to} />
    </section>
  );
}
