import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, homePath, branchLocked } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import { PageHeader } from "@/components/ui";
import { getBranchCommand, BRANCH_KEYS, weekPeriodLabel } from "@/lib/branch-command";
import { listProductionPeriods, getBranchProductionMonth, getLeftBehindJobs, getProductionRollup } from "@/lib/branch-production-ingest";
import BranchCommandBoard from "./BranchCommandBoard";
import ProductionCompletion from "./ProductionCompletion";

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

  // Production & Completion (route completion / left-behind) — the latest loaded month.
  const prodPeriods = await listProductionPeriods(branch);
  const prodPeriod = prodPeriods[0] ?? null;
  const prod = prodPeriod ? await getBranchProductionMonth(branch, prodPeriod) : null;
  const leftBehind = prodPeriod ? await getLeftBehindJobs(branch, prodPeriod) : [];
  const canUploadProd = user.role === "admin" || user.role === "manager";
  // Cross-branch production rollup for leadership (non-branch-locked viewers).
  const prodRollup = !locked ? await getProductionRollup([...BRANCH_KEYS]) : null;

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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Branch Command"
        subtitle={`${branchLabel(branch)} · ${payload.periodLabel} — review the week, respond to every flag, then sign.`}
        actions={
          !locked ? (
            <div className="flex flex-wrap gap-1.5">
              {BRANCH_KEYS.map((b) => (
                <Link
                  key={b}
                  href={`/branch-command?branch=${b}`}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                    b === branch ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-muted hover:bg-black/5"
                  }`}
                >
                  {branchLabel(b)}
                </Link>
              ))}
            </div>
          ) : null
        }
      />
      {prodRollup && prodRollup.some((r) => r.periodKey) && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">Completion rollup · all branches</div>
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

      <BranchCommandBoard data={payload} />

      <ProductionCompletion
        branch={branch}
        periodKey={prod?.periodKey ?? null}
        routes={(prod?.routes ?? []).map((r) => ({
          route: r.route, techName: r.techName, scheduledCount: r.scheduledCount, completedCount: r.completedCount,
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
  );
}
