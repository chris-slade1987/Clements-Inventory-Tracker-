import Link from "next/link";
import { PageHeader, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import GoalPlanner from "@/components/GoalPlanner";
import SalesFunnelCard from "@/components/SalesFunnelCard";
import LeadInsightsSection from "@/components/LeadInsightsSection";
import { resolveRange } from "@/lib/sales-leads";
import { advisorGoal, currentPeriodKey, periodLabel, parseInitiatives, recapPrefillFromPriorActuals } from "@/lib/sales";
import { advisorPaceSignal, priorPeriodKey } from "@/lib/sales-funnel";
import { listFocusItems } from "@/lib/sales-focus";
import { prisma } from "@/lib/prisma";

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
  const paceSignal = await advisorPaceSignal(user.employeeId, periodKey);
  const proposedByName = g.sheet?.proposedByUserId
    ? (await prisma.user.findUnique({ where: { id: g.sheet.proposedByUserId }, select: { name: true } }))?.name ?? null
    : null;
  const proposal = { proposedGoal: g.sheet?.proposedGoal ?? null, goalStatus: g.sheet?.goalStatus ?? null, proposedByName };

  // Prefill last month's recap from real actuals — only when the advisor hasn't
  // entered one yet (never overwrites saved numbers).
  const recapEntered = (g.recap.leads + g.recap.reis + g.recap.appts + g.recap.proposals + g.recap.pcExposed + g.recap.pcSold + g.recap.tcSold + g.recap.totalExposure + g.recap.tcUnits) > 0;
  const prefill = recapEntered ? null : await recapPrefillFromPriorActuals(user.employeeId, periodKey);

  // Structured Focus Plan for this month + whether last month had a plan to copy.
  const focusItems = await listFocusItems(user.employeeId, periodKey);
  const lastMonthFocus = await prisma.salesFocusItem.count({ where: { advisorEmployeeId: user.employeeId, periodKey: priorPeriodKey(periodKey), voided: false } });

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
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 19V5M4 19h16M8 15l3-4 3 3 4-6" /></svg>
          </span>
          <div>
            <div className="text-sm font-medium text-ink">Targets vs. actual</div>
            <p className="text-sm text-muted">The speedometer below colors by your real on-track pace — projected month-end close vs your goal — the moment results are in. For now, set your plan; it&apos;s your roadmap for the month.</p>
          </div>
        </div>
      </Card>

      <GoalPlanner
        periodKey={periodKey}
        periodLabelText={periodLabel(periodKey)}
        initial={initial}
        initialInitiatives={parseInitiatives(g.sheet?.initiatives)}
        initialNotes={g.sheet?.notesForDirector ?? ""}
        initialOverrides={{ leadsGoal: g.sheet?.leadsGoal ?? 0, proposalsGoal: g.sheet?.proposalsGoal ?? 0, dealsGoal: g.sheet?.dealsGoal ?? 0 }}
        canEdit
        viewerRole="advisor"
        paceSignal={paceSignal}
        proposal={proposal}
        prefill={prefill ? { recap: prefill.recap, source: "actuals" } : null}
        focusAdvisorId={user.employeeId}
        focusItems={focusItems}
        focusHasLastMonth={lastMonthFocus > 0}
        viewerName={user.name}
      />
    </>
  );
}
