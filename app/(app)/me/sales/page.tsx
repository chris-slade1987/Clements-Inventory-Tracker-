import Link from "next/link";
import { PageHeader, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import GoalPlanner from "@/components/GoalPlanner";
import { advisorGoal, currentPeriodKey, periodLabel } from "@/lib/sales";

export const dynamic = "force-dynamic";

export default async function MySalesPage() {
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
  const g = await advisorGoal(user.employeeId, periodKey);
  const initial = { ...g.recap, salesGoal: g.goal.salesGoal, workdays: g.goal.workdays };

  return (
    <>
      <div className="mb-2"><Link href="/me" className="text-xs font-medium text-brand-700 hover:underline">← My Work</Link></div>
      <PageHeader title="My Sales Goals" subtitle={`Monthly goal planner — ${periodLabel(periodKey)}`} />

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
