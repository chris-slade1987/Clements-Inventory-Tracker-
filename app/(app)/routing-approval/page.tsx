import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, homePath, branchLocked, isSuperAdmin } from "@/lib/auth";
import RoutingCredit from "./RoutingCredit";
import { branchLabel, BRANCHES } from "@/lib/management";
import { PageHeader } from "@/components/ui";
import { getRoutingOverview, currentRoutingPeriod, listRoutingPeriods, routingDueDate } from "@/lib/routing";
import RoutingBoard from "./RoutingBoard";
import SignoffModal from "./SignoffModal";
import MyBranchViewToggle from "../my-branch/MyBranchViewToggle";

// Routing Approval — monthly proactive routing review + per-technician sign-off.
// Managers see their branch; admins switch branches + load the monthly export.
export const dynamic = "force-dynamic";

const BRANCH_KEYS = BRANCHES.map((b) => b.key);

function periodLabel(pk: string): string {
  const [y, m] = pk.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function RoutingApprovalPage({ searchParams }: { searchParams: Promise<{ branch?: string; period?: string; signoff?: string }> }) {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "manager") redirect(homePath(user));
  const sp = await searchParams;
  const locked = branchLocked(user);
  const branch = locked
    ? user.branch || BRANCH_KEYS[0]
    : (sp.branch && (BRANCH_KEYS as readonly string[]).includes(sp.branch) ? sp.branch : user.branch) || BRANCH_KEYS[0];
  // Default to the most recently LOADED month (routing is reviewed ahead of time,
  // so the loaded month is usually next month — not today's). Explicit ?period wins.
  const loadedPeriods = await listRoutingPeriods(branch);
  const periodKey = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : loadedPeriods[0] ?? currentRoutingPeriod();
  // Months to offer in the selector: everything loaded + the current month.
  const periodOptions = [...new Set([...loadedPeriods, currentRoutingPeriod(), periodKey])].sort().reverse();

  const data = await getRoutingOverview(branch, periodKey);

  // Reached from the manager "Complete {month} routing sign-off" to-do → pop the
  // responsibility modal (deadline = first Friday of the period, e.g. Fri 11/6).
  const signoffDeadline = routingDueDate(periodKey).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });

  return (
    <div className="space-y-5">
      {sp.signoff === "1" ? (
        <SignoffModal open monthLabel={periodLabel(periodKey)} deadlineLabel={signoffDeadline} />
      ) : null}
      <MyBranchViewToggle view="routes" branchQuery={branch ? `?branch=${branch}` : ""} />
      <PageHeader
        title="Routes"
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
      {periodOptions.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Month:</span>
          {periodOptions.map((p) => (
            <Link
              key={p}
              href={`/routing-approval?branch=${branch}&period=${p}`}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${p === periodKey ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-muted hover:bg-black/5"}`}
            >
              {periodLabel(p)}{loadedPeriods.includes(p) ? "" : " (empty)"}
            </Link>
          ))}
        </div>
      ) : null}
      <RoutingCredit
        branch={branch}
        periodKey={periodKey}
        monthLabel={periodLabel(periodKey)}
        branchName={branchLabel(branch)}
        credited={data.month.creditedAt ? { at: data.month.creditedAt, by: data.month.creditedByName, note: data.month.creditNote } : null}
        canCredit={isSuperAdmin(user)}
      />
      <RoutingBoard data={data} canUpload={user.role === "admin"} periodKey={periodKey} />
    </div>
  );
}
