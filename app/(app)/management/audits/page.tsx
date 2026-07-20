import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState, btn } from "@/components/ui";
import { requireUser, isBoardObserver, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import { listAudits } from "@/lib/audit";

export const dynamic = "force-dynamic";

function scoreChip(pct: number) {
  const c = pct >= 85 ? "bg-emerald-100 text-emerald-700" : pct >= 70 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return `inline-grid place-items-center rounded-full px-2 py-0.5 text-xs font-bold ${c}`;
}

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const locked = branchLocked(user);
  const isAdmin = user.role === "admin";
  const audits = await listAudits(branch ?? undefined);

  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.floor(now.getMonth() / 3) + 1;

  return (
    <>
      <PageHeader title="Branch Audits" subtitle="Director of Field Ops · quarterly branch oversight" />

      {!locked ? (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <Pill href="/management/audits" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <Pill key={b.key} href={`/management/audits?branch=${b.key}`} label={b.label} active={branch === b.key} />
          ))}
        </div>
      ) : null}

      {isAdmin ? (
        <div className="mb-5 flex flex-wrap gap-2">
          <Link href={`/management/audits/edit?branch=${branch ?? BRANCHES[0].key}&year=${year}&quarter=${quarter}`} className={btn.primary}>+ New / continue audit</Link>
          <Link href={`/management/audits/prep?branch=${branch ?? BRANCHES[0].key}&year=${year}&quarter=${quarter}`} className={btn.secondary}>Pre-visit checklist</Link>
        </div>
      ) : null}

      {audits.length === 0 ? (
        <EmptyState title="No audits yet" hint={isAdmin ? "Start a new audit to begin." : "No audits recorded for this branch yet."} />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Quarter</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Visit date</th>
                  <th className="px-3 py-2 font-medium">Auditor</th>
                  <th className="px-3 py-2 font-medium text-right">Ride-alongs</th>
                  <th className="px-3 py-2 font-medium text-right">Follow-ups</th>
                  <th className="px-3 py-2 font-medium text-center">Score</th>
                  <th className="px-4 py-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => {
                  const openFu = a.followUps.filter((f) => f.status === "open").length;
                  return (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/management/audits/edit?branch=${a.branch}&year=${a.year}&quarter=${a.quarter}`} className="text-brand-700 hover:underline">Q{a.quarter} {a.year}</Link>
                      </td>
                      <td className="px-3 py-2 text-muted">{branchLabel(a.branch)}</td>
                      <td className="px-3 py-2 text-muted">{dateShort(a.visitDate)}</td>
                      <td className="px-3 py-2 text-muted">{a.auditorName ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{a.rideAlongs.length}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{openFu > 0 ? <span className="text-amber-600 font-medium">{openFu} open</span> : a.followUps.length}</td>
                      <td className="px-3 py-2 text-center"><span className={scoreChip(a.scorePct)}>{a.scorePct}%</span></td>
                      <td className="px-4 py-2 text-center">
                        {a.status === "submitted"
                          ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Submitted</span>
                          : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Draft</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Pill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>
      {label}
    </Link>
  );
}
