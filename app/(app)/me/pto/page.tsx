import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ptoBalance, requestsForEmployee, PTO_TYPES, isManagerOrAbove } from "@/lib/pto";
import { ensureSelfEmployeeLink } from "@/lib/self-link";
import MyPtoPanel from "@/components/MyPtoPanel";

export const dynamic = "force-dynamic";

export default async function MyPtoPage() {
  const user = await requireUser();
  const employeeId = user.employeeId ?? (await ensureSelfEmployeeLink(user));
  if (!employeeId) {
    return (
      <>
        <PageHeader title="My PTO" subtitle="Request time off and track your balance" />
        <EmptyState title="No personnel profile linked" hint="This login isn't linked to an employee profile, so PTO can't be tracked yet. Ask HR to link your profile." />
      </>
    );
  }

  const [balance, requests] = await Promise.all([
    ptoBalance(employeeId),
    requestsForEmployee(employeeId),
  ]);

  return (
    <>
      <div className="mb-2"><Link href="/me" className="text-xs font-medium text-brand-700 hover:underline">← My Work</Link></div>
      <PageHeader title="My PTO" subtitle="Request time off, see your balance, and track approvals" />
      <MyPtoPanel
        balance={balance}
        routesToHr={isManagerOrAbove(user)}
        types={PTO_TYPES.map((t) => ({ key: t.key, label: t.label }))}
        requests={requests.map((r) => ({
          id: r.id,
          startDate: r.startDate.toISOString(),
          endDate: r.endDate.toISOString(),
          days: r.days,
          type: r.type,
          status: r.status,
          note: r.note,
          decisionNote: r.decisionNote,
          reviewedByName: r.reviewedByName,
        }))}
      />
    </>
  );
}
