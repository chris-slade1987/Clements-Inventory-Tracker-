import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { monthlyQcProgress, listQcInspections, branchTechnicians, monthKey, QC_ITEMS, QC_TYPES } from "@/lib/qc";
import QcClient from "./QcClient";

export const dynamic = "force-dynamic";

export default async function QcPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested) ?? BRANCHES[0].key;
  const locked = branchLocked(user);
  const canComplete = user.role === "manager" || user.role === "admin";

  const [progress, technicians, recent] = await Promise.all([
    monthlyQcProgress(branch),
    branchTechnicians(branch),
    listQcInspections(branch, 100),
  ]);

  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title="Quality Control"
        subtitle={`${branchLabel(branch)} · field ride-behinds · goal 10 GHP + 10 L&O per month`}
      />
      {technicians.length === 0 && canComplete ? (
        <EmptyState title="No technicians on this branch's roster" hint="Add active technicians to this branch in People / HR before completing a QC inspection." />
      ) : (
        <QcClient
          branch={branch}
          branchLabel={branchLabel(branch)}
          branches={locked ? [] : BRANCHES.map((b) => ({ key: b.key, label: b.label }))}
          canComplete={canComplete}
          technicians={technicians.map((t) => ({ id: t.id, name: t.name }))}
          progress={progress}
          monthLabel={monthLabel}
          reviewerName={user.name}
          types={QC_TYPES}
          forms={QC_ITEMS}
          recent={recent.map((r) => ({
            id: r.id,
            type: r.type,
            acctNumber: r.acctNumber,
            customer: `${r.customerFirst} ${r.customerLast}`,
            technicianName: r.technicianName,
            technicianEmployeeId: r.technicianEmployeeId,
            inspectionDate: r.inspectionDate.toISOString(),
            passCount: r.passCount,
            failCount: r.failCount,
            periodKey: r.periodKey,
          }))}
          thisMonthKey={monthKey()}
        />
      )}
    </>
  );
}
