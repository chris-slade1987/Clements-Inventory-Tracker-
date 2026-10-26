import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { requireUser, isFieldOpsDirector, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AuditView from "@/components/AuditView";
import AuditActions from "./AuditActions";

export const dynamic = "force-dynamic";

// Read-only "signed form" view of a branch audit. Reachable by admins / the
// Director of Field Ops, and by the branch's own manager (from their profile or
// the Branch Hub). The printable record filed in all three places.
export default async function AuditViewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const audit = await prisma.branchAudit.findUnique({
    where: { id },
    include: { rideAlongs: true, followUps: { orderBy: { createdAt: "asc" } } },
  });
  if (!audit) notFound();

  const isAdmin = user.role === "admin";
  const isBranchMgr = branchLocked(user) && user.branch === audit.branch;
  const canSee = isAdmin || isFieldOpsDirector(user) || isBranchMgr;
  if (!canSee) redirect("/my-branch");

  // The branch manager can sign in-app from here while it's awaiting them.
  const canSignNow = isBranchMgr && audit.status === "pending_manager" && !!audit.managerSignToken;

  return (
    <>
      {canSignNow ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 print:hidden">
          <div className="text-sm text-amber-800"><span className="font-medium">This audit needs your signature.</span> Review it below, then sign to file it.</div>
          <Link href={`/audit-sign/${audit.managerSignToken}`} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Review &amp; sign →</Link>
        </div>
      ) : null}
      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <Link href="/management/audits" className="text-xs font-medium text-brand-700 hover:underline">← Branch Audits</Link>
        <AuditActions id={audit.id} branch={audit.branch} year={audit.year} quarter={audit.quarter} status={audit.status} isAdmin={isAdmin} />
      </div>
      <Card className="p-5 sm:p-7 surface-light bg-white">
        <AuditView audit={audit} />
      </Card>
    </>
  );
}
