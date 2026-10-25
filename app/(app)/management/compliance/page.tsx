import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { canViewCompliance } from "@/lib/compliance";
import ExecTabs from "@/app/(app)/executive/ExecTabs";
import { CommandCenterPanel } from "./CommandCenterPanel";
import { InsurancePanel } from "./InsurancePanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compliance & Insurance — CanopyOS" };

type TabKey = "command-center" | "insurance";

// Who may view the Insurance section: admin / senior leadership / HR. (Insurance
// was folded into this center from the former standalone `/management/insurance`
// page — nav/IA refactor P2. Both are licenses / policies / renewals.)
function canViewInsurance(user: { role: string; seniorLeadership: boolean; hrAccess: boolean }): boolean {
  return user.role === "admin" || user.seniorLeadership || user.hrAccess;
}

// Compliance & Insurance Command Center. Two tabs over the licenses/leases/policies/
// renewals domain: Command Center (senior-leadership health board, coverage matrix,
// renewal calendar) and Insurance (policies, annual cost, payment forecast). The
// Insurance tab additionally serves HR, who have insurance access but not the
// senior-leadership compliance board — they see only the Insurance tab.
export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const canCompliance = canViewCompliance(user);
  const canInsurance = canViewInsurance(user);
  if (!canCompliance && !canInsurance) redirect("/dashboard");

  const tabs = [
    { key: "command-center", label: "Command Center", show: canCompliance },
    { key: "insurance", label: "Insurance", show: canInsurance },
  ].filter((t) => t.show);

  // Default to the Command Center for compliance viewers; HR (insurance-only) lands
  // on Insurance. An unknown/unentitled tab falls back to the first allowed tab.
  let active: TabKey = (sp.tab as TabKey) ?? (canCompliance ? "command-center" : "insurance");
  if (!tabs.some((t) => t.key === active)) active = tabs[0].key as TabKey;

  return (
    <>
      <PageHeader
        title="Compliance &amp; Insurance Command Center"
        subtitle="Every license, insurance policy, lease & renewal across Clements — one live view. Senior leadership only (Insurance also available to HR)."
      />
      <ExecTabs tabs={tabs} active={active} basePath="/management/compliance" />
      {active === "insurance" ? <InsurancePanel /> : <CommandCenterPanel />}
    </>
  );
}
