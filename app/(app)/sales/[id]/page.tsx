import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, canManageSales, canViewSales, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import GoalPlanner from "@/components/GoalPlanner";
import { advisorGoal, currentPeriodKey, periodLabel, parseInitiatives, recapPrefillFromPriorActuals } from "@/lib/sales";
import { advisorPaceSignal, priorPeriodKey } from "@/lib/sales-funnel";
import { listFocusItems } from "@/lib/sales-focus";
import { branchLabel } from "@/lib/management";

export const dynamic = "force-dynamic";

export default async function AdvisorGoalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canViewSales(user)) redirect("/me");
  const { id } = await params;

  const emp = await prisma.employee.findUnique({ where: { id }, select: { id: true, name: true, branch: true } });
  if (!emp) notFound();
  // Branch managers may only open their OWN branch's advisors, read-only.
  if (branchLocked(user) && emp.branch !== user.branch) redirect("/sales");
  const canManage = canManageSales(user);

  const periodKey = currentPeriodKey();
  const g = await advisorGoal(emp.id, periodKey);
  const initial = { ...g.recap, salesGoal: g.goal.salesGoal, workdays: g.goal.workdays };
  const paceSignal = await advisorPaceSignal(emp.id, periodKey);
  const proposedByName = g.sheet?.proposedByUserId
    ? (await prisma.user.findUnique({ where: { id: g.sheet.proposedByUserId }, select: { name: true } }))?.name ?? null
    : null;
  const proposal = { proposedGoal: g.sheet?.proposedGoal ?? null, goalStatus: g.sheet?.goalStatus ?? null, proposedByName };

  const recapEntered = (g.recap.leads + g.recap.reis + g.recap.appts + g.recap.proposals + g.recap.pcExposed + g.recap.pcSold + g.recap.tcSold + g.recap.totalExposure + g.recap.tcUnits) > 0;
  const prefill = recapEntered ? null : await recapPrefillFromPriorActuals(emp.id, periodKey);
  const focusItems = await listFocusItems(emp.id, periodKey);
  const lastMonthFocus = await prisma.salesFocusItem.count({ where: { advisorEmployeeId: emp.id, periodKey: priorPeriodKey(periodKey), voided: false } });

  return (
    <>
      <div className="mb-2"><Link href="/sales" className="text-xs font-medium text-brand-700 hover:underline">← Sales Team</Link></div>
      <PageHeader title={emp.name} subtitle={`${emp.branch ? branchLabel(emp.branch) + " · " : ""}Monthly goal sheet — ${periodLabel(periodKey)}`} />
      <GoalPlanner
        periodKey={periodKey}
        periodLabelText={periodLabel(periodKey)}
        advisorEmployeeId={emp.id}
        advisorName={emp.name}
        initial={initial}
        initialInitiatives={parseInitiatives(g.sheet?.initiatives)}
        initialNotes={g.sheet?.notesForDirector ?? ""}
        initialOverrides={{ leadsGoal: g.sheet?.leadsGoal ?? 0, proposalsGoal: g.sheet?.proposalsGoal ?? 0, dealsGoal: g.sheet?.dealsGoal ?? 0 }}
        canEdit={canManage}
        viewerRole="director"
        paceSignal={paceSignal}
        proposal={proposal}
        prefill={prefill ? { recap: prefill.recap, source: "actuals" } : null}
        focusAdvisorId={emp.id}
        focusItems={focusItems}
        focusHasLastMonth={lastMonthFocus > 0}
        viewerName={user.name}
      />
    </>
  );
}
