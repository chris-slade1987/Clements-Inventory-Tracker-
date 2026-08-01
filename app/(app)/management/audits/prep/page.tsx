import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { PRECHECK_GROUPS } from "@/lib/audit";
import PrecheckClient from "./PrecheckClient";

export const dynamic = "force-dynamic";

export default async function PrecheckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const now = new Date();
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? BRANCHES[0].key;
  const year = Number(sp.year) || now.getFullYear();
  const quarter = [1, 2, 3, 4].includes(Number(sp.quarter)) ? Number(sp.quarter) : Math.floor(now.getMonth() / 3) + 1;

  const existing = await prisma.auditPrecheck.findUnique({ where: { branch_year_quarter: { branch, year, quarter } } });
  let items: Record<string, boolean> = {};
  try { items = existing?.items ? JSON.parse(existing.items) : {}; } catch { items = {}; }

  return (
    <>
      <div className="mb-2">
        <Link href="/management/audits" className="text-xs font-medium text-brand-700 hover:underline">← Branch Audits</Link>
      </div>
      <PageHeader title="Pre-visit Prep Checklist" subtitle={`${branchLabel(branch)} · Q${quarter} ${year} — complete before the branch visit`} />
      <PrecheckClient
        branch={branch}
        year={year}
        quarter={quarter}
        groups={PRECHECK_GROUPS.map((g, gi) => ({ group: g.group, items: g.items.map((label, ii) => ({ key: `g${gi}i${ii}`, label })) }))}
        initial={items}
        initialNotes={existing?.notes ?? ""}
      />
    </>
  );
}
