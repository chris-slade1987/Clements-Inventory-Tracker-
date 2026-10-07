import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { INVENTORY_ALERT_TYPES } from "@/lib/anomaly";
import { pastDueClearableCounts } from "@/lib/manual-reminders";
import AlertsClient from "./AlertsClient";
import ClearPastDueButton from "./ClearPastDueButton";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  // This is the COMPANY inventory alerts/ops surface. A branch-locked manager
  // sees their own branch's actionable items (incl. branch low-stock) on their
  // My Branch "Needs attention" feed instead — send them there.
  if (branchLocked(user)) redirect("/my-branch");

  const sp = await searchParams;
  const show = sp.show === "all" || sp.show === "dismissed" ? sp.show : "active";

  const statusFilter =
    show === "dismissed"
      ? { status: "dismissed" }
      : show === "all"
        ? {}
        : { status: { in: ["open", "acknowledged"] } };

  const [alerts, threshold] = await Promise.all([
    prisma.alert.findMany({
      // INVENTORY alerts only — personnel / compliance / fleet-review alert types
      // are surfaced on their own screens, not here.
      where: { ...statusFilter, type: { in: [...INVENTORY_ALERT_TYPES] } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { product: { select: { name: true } } },
      take: 200,
    }),
    prisma.setting.findUnique({ where: { key: "price_increase_threshold_pct" } }),
  ]);

  const isAdmin = user.role === "admin";
  // Admin-only: how many past-due reminders + audit follow-ups can be cleared.
  const pastDue = isAdmin ? await pastDueClearableCounts() : { reminders: 0, auditFollowUps: 0, total: 0 };

  return (
    <>
      <PageHeader
        title="Inventory Alerts"
        subtitle="Anomalies, low-stock, and cost-saving opportunities flagged by the automated checks."
      />
      {isAdmin ? <ClearPastDueButton counts={pastDue} /> : null}
      <AlertsClient
        show={show}
        isAdmin={isAdmin}
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
