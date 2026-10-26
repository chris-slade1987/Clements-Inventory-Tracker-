import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { requireUser, branchLocked, isFieldOpsDirector } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { priorInspection, repeatFailures, parseJson, type Checks } from "@/lib/warehouse";
import PrintButton from "@/components/PrintButton";
import WarehouseReport from "@/components/WarehouseReport";

export const dynamic = "force-dynamic";

// Read-only, printable warehouse-inspection report (→ browser Print / Save as PDF).
export default async function WarehouseReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const inspection = await prisma.warehouseInspection.findUnique({
    where: { id },
    include: { photos: true, needs: { orderBy: { createdAt: "asc" } } },
  });
  if (!inspection) notFound();

  const isAdmin = user.role === "admin";
  const canSee = isAdmin || isFieldOpsDirector(user) || (branchLocked(user) && user.branch === inspection.branch) || user.role === "manager";
  if (!canSee) redirect("/my-branch");

  const prior = await priorInspection(inspection.branch, inspection.year, inspection.month);
  const repeats = repeatFailures(parseJson<Checks>(inspection.checks, {}), prior ? parseJson<Checks>(prior.checks, {}) : null);
  const canEdit = isAdmin || (user.role === "manager" && (!branchLocked(user) || user.branch === inspection.branch));

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <Link href="/my-branch/warehouse" className="text-xs font-medium text-brand-700 hover:underline">← Warehouse Safety</Link>
        <div className="flex items-center gap-2">
          {canEdit ? <Link href={`/my-branch/warehouse/inspect?branch=${inspection.branch}&year=${inspection.year}&month=${inspection.month}`} className={btn.secondary}>Edit</Link> : null}
          <PrintButton variant="primary" />
        </div>
      </div>
      <Card className="p-5 sm:p-7 surface-light bg-white">
        <WarehouseReport
          inspection={{
            id: inspection.id, branch: inspection.branch, year: inspection.year, month: inspection.month, date: inspection.date,
            inspectorName: inspection.inspectorName, score: inspection.score, maxScore: inspection.maxScore, scorePct: inspection.scorePct, grade: inspection.grade,
            checks: inspection.checks, comments: inspection.comments, notes: inspection.notes,
            inspectorSignedName: inspection.inspectorSignedName, inspectorSignedAt: inspection.inspectorSignedAt,
            needs: inspection.needs.map((n) => ({ id: n.id, itemKey: n.itemKey, label: n.label, request: n.request, status: n.status })),
            photos: inspection.photos.map((p) => ({ promptKey: p.promptKey, label: p.label, photoUrl: p.photoUrl, caption: p.caption })),
          }}
          repeats={repeats}
        />
      </Card>
    </>
  );
}
