import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, homePath, branchLocked } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import { getBranchCommand, BRANCH_KEYS, weekPeriodLabel } from "@/lib/branch-command";
import { listProductionPeriods, getBranchProductionMonth, getLeftBehindJobs, getProductionRollup } from "@/lib/branch-production-ingest";
import { getRoutingSummary } from "@/lib/routing";
import MyBranchViewToggle from "../my-branch/MyBranchViewToggle";
import BranchCommandHero from "./BranchCommandHero";
import BranchCommandFlow from "./BranchCommandFlow";
import BranchCommandBoard from "./BranchCommandBoard";
import ProductionCompletion from "./ProductionCompletion";

function monthLabelOf(pk: string | null): string | null {
  if (!pk) return null;
  const [y, m] = pk.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
// Current calendar month (Eastern) as YYYY-MM — Branch Command defaults here.
function currentMonthKeyET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

// Branch Command — the branch manager's weekly cockpit. Managers see their own
// branch; admins/leadership can switch branches. See docs/BRANCH-COMMAND.md.
export const dynamic = "force-dynamic";

export default async function BranchCommandPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "manager") redirect(homePath(user));

  const sp = await searchParams;
  const locked = branchLocked(user);
  const branch = locked
    ? user.branch || BRANCH_KEYS[0]
    : (sp.branch && (BRANCH_KEYS as readonly string[]).includes(sp.branch) ? sp.branch : user.branch) || BRANCH_KEYS[0];

  const data = await getBranchCommand(branch);

  // Production & Completion — default to the CURRENT calendar month; if it isn't
  // loaded yet, fall back to the most recent loaded month (flagged in the hero).
  const prodPeriods = await listProductionPeriods(branch);
  const currentMonthKey = currentMonthKeyET();
  const prodPeriod = prodPeriods.includes(currentMonthKey) ? currentMonthKey : (prodPeriods[0] ?? null);
  const prod = prodPeriod ? await getBranchProductionMonth(branch, prodPeriod) : null;
  const leftBehind = prodPeriod ? await getLeftBehindJobs(branch, prodPeriod) : [];
  const canUploadProd = user.role === "admin" || user.role === "manager";
  // Cross-branch production rollup for leadership (non-branch-locked viewers).
  const prodRollup = !locked ? await getProductionRollup([...BRANCH_KEYS]) : null;

  // Next month's routing to approve (routing is loaded ahead of time; this is the
  // month "up for review"). Drives the weekly-flow prompt.
  const routing = await getRoutingSummary(branch);
  const routingPeriodLabel = monthLabelOf(routing.periodKey) ?? "next month";

  // Data freshness — latest upload time + how many of the six reports are loaded.
  const latestUpload = prod?.uploads?.[0]?.uploadedAt ?? null;
  const freshness = {
    updatedLabel: latestUpload
      ? new Date(latestUpload).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
      : null,
    reportCount: prod?.uploads?.length ?? 0,
    isCurrentMonth: prodPeriod === currentMonthKey,
    currentMonthLabel: monthLabelOf(currentMonthKey) ?? "",
  };

  // Serialize dates for the client component.
  const payload = {
    branch,
    periodLabel: weekPeriodLabel(new Date()),
    status: data.branchWeek.status,
    scoreboard: data.scoreboard,
    techWeeks: data.techWeeks.map((t) => ({
      id: t.id,
      techName: t.techName,
      routeNo: t.routeNo,
      production: t.production,
      productionTarget: t.productionTarget,
      stops: t.stops,
      stopsPerDay: t.stopsPerDay,
      unserviced: t.unserviced,
      cancellations: t.cancellations,
      callbacks: t.callbacks,
      callbackRate: t.callbackRate,
      status: t.status,
      reviewed: t.reviewed,
      managerNote: t.managerNote,
    })),
    findings: data.findings.map((f) => ({
      id: f.id,
      domain: f.domain,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      question: f.question,
      techName: f.techName,
      requiresResponse: f.requiresResponse,
      managerResponse: f.managerResponse,
      status: f.status,
    })),
    gate: data.gate,
    signedName: data.branchWeek.signedName,
    signedAt: data.branchWeek.signedAt ? data.branchWeek.signedAt.toISOString() : null,
  };

  const heroTotals = prod?.totals ?? { scheduled: 0, completed: 0, completionPct: 0, leftBehind: 0, leftBehindDollars: 0, remaining: 0, callbacks: 0, netChange: 0, netChangeDollars: 0 };

  // Live sign-progress for the guided playbook meter (done/total per blocker).
  const progress = {
    checkoffs: {
      done: payload.scoreboard.reduce((a, d) => a + d.items.filter((i) => i.checked).length, 0),
      total: payload.scoreboard.reduce((a, d) => a + d.items.length, 0),
    },
    techs: { done: payload.techWeeks.filter((t) => t.reviewed).length, total: payload.techWeeks.length },
    flags: {
      done: payload.findings.filter((f) => f.requiresResponse && f.status !== "open").length,
      total: payload.findings.filter((f) => f.requiresResponse).length,
    },
    jobs: { done: leftBehind.filter((j) => j.status === "addressed").length, total: leftBehind.length },
  };

  return (
    <div className="space-y-5">
      <MyBranchViewToggle view="command" branchQuery={branch ? `?branch=${branch}` : ""} />

      <BranchCommandHero
        branch={branch}
        periodLabel={payload.periodLabel}
        monthLabel={monthLabelOf(prodPeriod)}
        hasProd={!!prod && prod.routes.length > 0}
        totals={heroTotals}
        status={payload.status}
        gate={payload.gate}
        signedName={payload.signedName}
        signedAt={payload.signedAt}
        locked={locked}
        branches={BRANCH_KEYS}
        freshness={freshness}
      />

      <BranchCommandFlow
        branch={branch}
        monthLabel={monthLabelOf(prodPeriod)}
        hasProd={!!prod && prod.routes.length > 0}
        gate={payload.gate}
        progress={progress}
        signed={payload.status === "signed"}
        routing={{
          loaded: routing.loaded,
          signed: routing.signed,
          periodLabel: routingPeriodLabel,
          approved: routing.approved,
          techs: routing.techs,
          href: `/routing-approval?branch=${branch}&period=${routing.periodKey}`,
        }}
      />

      {prodRollup && prodRollup.some((r) => r.periodKey) && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wide text-muted">Completion rollup · all branches</div>
            <span className="text-[11px] text-muted">latest loaded month</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {prodRollup.map((r) => (
              <Link key={r.branch} href={`/branch-command?branch=${r.branch}`} className={`rounded-lg border p-3 hover:bg-black/[0.02] ${r.branch === branch ? "border-brand-500" : "border-line"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{branchLabel(r.branch)}</span>
                  <span className="text-lg font-light tabular-nums text-ink">{r.periodKey ? `${r.completionPct}%` : "—"}</span>
                </div>
                {r.periodKey ? (
                  <div className="mt-1 text-[11px] text-muted">
                    <span className={r.leftBehind > 0 ? "text-red-600" : ""}>{r.leftBehind} left behind</span> · {r.callbacks} callbacks
                    {r.netChangeDollars !== 0 && <> · <span className={r.netChangeDollars < 0 ? "text-red-600" : "text-brand-700"}>{r.netChangeDollars < 0 ? "-" : "+"}${Math.abs(Math.round(r.netChangeDollars)).toLocaleString()}</span></>}
                  </div>
                ) : <div className="mt-1 text-[11px] text-muted">No month loaded</div>}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div id="route-completion" className="scroll-mt-4">
        <ProductionCompletion
          branch={branch}
          periodKey={prod?.periodKey ?? null}
          routes={(prod?.routes ?? []).map((r) => ({
          route: r.route, techName: r.techName, scheduledCount: r.scheduledCount, scheduledDollars: r.scheduledDollars, completedCount: r.completedCount,
          completionPct: r.completionPct, expectedPct: r.expectedPct, status: r.status, leftBehindCount: r.leftBehindCount,
          leftBehindDollars: r.leftBehindDollars, remainingCount: r.remainingCount, projectedPct: r.projectedPct,
          callbacks: r.callbacks, netRouteChange: r.netRouteChange, netRouteChangeDollars: r.netRouteChangeDollars,
        }))}
          totals={prod?.totals ?? { scheduled: 0, completed: 0, completionPct: 0, leftBehind: 0, leftBehindDollars: 0, remaining: 0, callbacks: 0, netChange: 0, netChangeDollars: 0 }}
          leftBehind={leftBehind}
          uploads={prod?.uploads ?? []}
          canUpload={canUploadProd}
        />
      </div>

      <BranchCommandBoard data={payload} />
    </div>
  );
}
