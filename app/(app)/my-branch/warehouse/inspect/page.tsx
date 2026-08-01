import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { parseJson } from "@/lib/warehouse";
import WarehouseForm from "./WarehouseForm";

export const dynamic = "force-dynamic";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export default async function WarehouseInspectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "manager") redirect("/my-branch");
  const sp = await searchParams;
  const now = new Date();
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? user.branch ?? BRANCHES[0].key;
  if (branchLocked(user) && branch !== user.branch) redirect("/my-branch/warehouse");
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;

  const existing = await prisma.warehouseInspection.findUnique({ where: { branch_year_month: { branch, year, month } } });

  const prefill = {
    date: existing ? iso(existing.date) : iso(now),
    inspectorName: existing?.inspectorName ?? user.name,
    checks: parseJson<Record<string, boolean>>(existing?.checks, {}),
    comments: parseJson<Record<string, string>>(existing?.comments, {}),
    notes: existing?.notes ?? "",
  };

  return (
    <>
      <div className="mb-2">
        <Link href="/my-branch/warehouse" className="text-xs font-medium text-brand-700 hover:underline">← Warehouse Safety</Link>
      </div>
      <PageHeader title="Warehouse Safety Inspection" subtitle={`${branchLabel(branch)} · ${new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" })} ${year}`} />
      <WarehouseForm branch={branch} year={year} month={month} isEdit={!!existing} prefill={prefill} />
    </>
  );
}
