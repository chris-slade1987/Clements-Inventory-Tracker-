import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, homePath, branchLocked } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import { PageHeader } from "@/components/ui";
import { getBranchCommand, BRANCH_KEYS, weekPeriodLabel } from "@/lib/branch-command";
import BranchCommandBoard from "./BranchCommandBoard";

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
      <BranchCommandBoard data={payload} />
    </div>
  );
}
