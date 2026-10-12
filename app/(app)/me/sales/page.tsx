import Link from "next/link";
import { PageHeader, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import GoalPlanner from "@/components/GoalPlanner";
import SalesFunnelCard from "@/components/SalesFunnelCard";
import LeadInsightsSection from "@/components/LeadInsightsSection";
import { resolveRange } from "@/lib/sales-leads";
import { advisorGoal, currentPeriodKey, periodLabel } from "@/lib/sales";

export const dynamic = "force-dynamic";

export default async function MySalesPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const user = await requireUser();
  if (!user.employeeId) {
    return (
      <>
        <PageHeader title="My Sales Goals" subtitle="Plan your month and track your targets" />
        <Card className="p-6"><p className="text-sm text-muted">Your login isn&apos;t linked to an employee profile yet, so we can&apos;t load your goal sheet. Ask an admin to link your account.</p></Card>
      </>
    );
  }

  const periodKey = currentPeriodKey();
  const sp = await searchParams;
  const range = resolveRange(sp.range, sp.from, sp.to);
  const g = await advisorGoal(user.employeeId, periodKey);
  const initial = { ...g.recap, salesGoal: g.goal.salesGoal, workdays: g.goal.workdays };

  return (
    <>
      <div className="mb-2"><Link href="/me" className="text-xs font-medium text-brand-700 hover:underline">← My Work</Link></div>
      <PageHeader title="My Sales Goals" subtitle={`Monthly goal planner — ${periodLabel(periodKey)}`} />

      <SalesFunnelCard advisorEmployeeId={user.employeeId} periodKey={periodKey} />

      {/* Your personal lead heat map + lead-source performance — the areas and
          sources that work best for you, so you can target them more often. */}
      <LeadInsightsSection
        scope="advisor"
        advisorEmployeeId={user.employeeId}
        range={range}
        mapTitle="Your lead heat map"
        mapSubtitle="The neighborhoods you work and how they perform for you. Concentrate on your densest, highest-closing areas. Color-coded by funnel stage."
      />

      <Card className="p-4 mb-5">
        <div className="flex items-start gap-3">
          <span className="text-lg">📊</span>
          <div>
            <div className="text-sm font-medium text-ink">Targets vs. actual</div>
            <p className="text-sm text-muted">Your live sales results will show next to these targets once the sales system is connected. For now, set your plan below — it&apos;s your roadmap for the month.</p>
          </div>
        </div>
      </Card>

      <GoalPlanner
        periodKey={periodKey}
        periodLabelText={periodLabel(periodKey)}
        initial={initial}
        canEdit
      />
    </>
  );
}
