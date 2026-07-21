import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canClearChecklistMiss } from "@/lib/personnel";
import { sweepMissedChecklists, openMisses, clearedMisses } from "@/lib/checklists";
import ChecklistMisses, { type MissDTO } from "../checklists/ChecklistMisses";
import AlertsClient from "./AlertsClient";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const show = sp.show === "all" || sp.show === "dismissed" ? sp.show : "active";

  // Lazy, idempotent detection of missed weekly checklists (no cron), reported
  // here as a compliance section alongside inventory alerts.
  await sweepMissedChecklists();
  const [openM, clearedM] = await Promise.all([openMisses(), clearedMisses()]);
  const canClear = canClearChecklistMiss(user);
  const toDTO = (m: Awaited<ReturnType<typeof openMisses>>[number]): MissDTO => ({
    id: m.id,
    branchLabel: m.branchLabel,
    periodLabel: m.periodLabel,
    cadence: m.cadence,
    createdAt: m.createdAt.toISOString(),
    clearedByName: m.clearedByName,
    clearedAt: m.clearedAt ? m.clearedAt.toISOString() : null,
    clearNote: m.clearNote,
  });

  const statusFilter =
    show === "dismissed"
      ? { status: "dismissed" }
      : show === "all"
        ? {}
        : { status: { in: ["open", "acknowledged"] } };

  const [alerts, threshold] = await Promise.all([
    prisma.alert.findMany({
      where: statusFilter,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { product: { select: { name: true } } },
      take: 200,
    }),
    prisma.setting.findUnique({ where: { key: "price_increase_threshold_pct" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Anomalies and cost-saving opportunities flagged by the automated checks."
      />
      {openM.length > 0 || clearedM.length > 0 ? (
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-600">Compliance · missed checklists</div>
          <ChecklistMisses open={openM.map(toDTO)} cleared={clearedM.map(toDTO)} canClear={canClear} showHistory={false} />
        </div>
      ) : null}
      <AlertsClient
        show={show}
        thresholdPct={threshold?.value ?? "10"}
        alerts={alerts.map((a) => ({
          id: a.id,
          type: a.type,
          message: a.message,
          severity: a.severity,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
          productName: a.product?.name ?? null,
        }))}
      />
    </>
  );
}
