import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, homePath, branchLocked } from "@/lib/auth";
import { branchLabel, BRANCHES } from "@/lib/management";
import { PageHeader } from "@/components/ui";
import { getRoutingOverview, currentRoutingPeriod } from "@/lib/routing";
import RoutingBoard from "./RoutingBoard";

// Routing Approval — monthly proactive routing review + per-technician sign-off.
// Managers see their branch; admins switch branches + load the monthly export.
export const dynamic = "force-dynamic";

const BRANCH_KEYS = BRANCHES.map((b) => b.key);

function periodLabel(pk: string): string {
  const [y, m] = pk.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function RoutingApprovalPage({ searchParams }: { searchParams: Promise<{ branch?: string; period?: string }> }) {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "manager") redirect(homePath(user));
  const sp = await searchParams;
  const locked = branchLocked(user);
  const branch = locked
    ? user.branch || BRANCH_KEYS[0]
    : (sp.branch && (BRANCH_KEYS as readonly string[]).includes(sp.branch) ? sp.branch : user.branch) || BRANCH_KEYS[0];
  const periodKey = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : currentRoutingPeriod();

  const data = await getRoutingOverview(branch, periodKey);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Routing Approval"
        subtitle={`${branchLabel(branch)} · ${periodLabel(periodKey)} — review each technician's routing, then sign.`}
        actions={
          !locked ? (
            <div className="flex flex-wrap gap-1.5">
              {BRANCH_KEYS.map((b) => (
                <Link
                  key={b}
                  href={`/routing-approval?branch=${b}&period=${periodKey}`}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${b === branch ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-muted hover:bg-black/5"}`}
                >
                  {branchLabel(b)}
                </Link>
              ))}
            </div>
          ) : null
        }
      />
      <RoutingBoard data={data} canUpload={user.role === "admin"} periodKey={periodKey} />
    </div>
  );
}
