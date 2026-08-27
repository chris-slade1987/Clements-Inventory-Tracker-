import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, canManageSales } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import GoalPlanner from "@/components/GoalPlanner";
import { advisorGoal, currentPeriodKey, periodLabel } from "@/lib/sales";
import { branchLabel } from "@/lib/management";

export const dynamic = "force-dynamic";

export default async function AdvisorGoalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManageSales(user)) redirect("/me");
  const { id } = await params;

  const emp = await prisma.employee.findUnique({ where: { id }, select: { id: true, name: true, branch: true } });
  if (!emp) notFound();

  const periodKey = currentPeriodKey();
  const g = await advisorGoal(emp.id, periodKey);
  const initial = { ...g.recap, salesGoal: g.goal.salesGoal, workdays: g.goal.workdays };

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
        canEdit
      />
    </>
  );
}
