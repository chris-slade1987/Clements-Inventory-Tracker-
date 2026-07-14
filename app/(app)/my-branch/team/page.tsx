import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { teamRoster } from "@/lib/personnel";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const branch = scopedBranch(user, BRANCHES.find((b) => b.key === sp.branch)?.key ?? null);
  const locked = branchLocked(user);
  const roster = await teamRoster(branch ?? undefined);

  return (
    <>
      <PageHeader title="My Team" subtitle="Select a team member to file a write-up, note, recognition, or accident report" />

      {!locked ? (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <Pill href="/my-branch/team" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => <Pill key={b.key} href={`/my-branch/team?branch=${b.key}`} label={b.label} active={branch === b.key} />)}
        </div>
      ) : null}

      {roster.length === 0 ? (
        <EmptyState title="No team members" hint="No active employees for this branch." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium text-right">Write-ups</th>
                  <th className="px-3 py-2 font-medium text-right">Accidents</th>
                  <th className="px-4 py-2 font-medium text-right">Records</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium"><Link href={`/my-branch/team/${e.id}`} className="text-brand-700 hover:underline">{e.name}</Link></td>
                    <td className="px-3 py-2 text-muted">{e.role ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{e.branch ? branchLabel(e.branch) : "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${e.writeups ? "text-amber-600 font-medium" : "text-muted"}`}>{e.writeups || "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${e.accidents ? "text-red-600 font-medium" : "text-muted"}`}>{e.accidents || "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">{e.total || "—"}</td>
                  </tr>
                ))}
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
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>{label}</Link>
  );
}
