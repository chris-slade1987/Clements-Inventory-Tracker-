import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AlertsClient from "./AlertsClient";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
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
