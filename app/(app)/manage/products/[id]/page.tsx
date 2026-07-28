import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uomLabel } from "@/lib/uom";
import { divisionLabel } from "@/lib/constants";
import { money, qty, dateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

const MOVE_LABEL: Record<string, string> = { check_in: "Check-in", check_out: "Check-out", adjustment: "Adjustment" };

export default async function ProductProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) notFound();

  const [warehouses, grouped, movements] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.stockMovement.groupBy({ by: ["warehouseId"], where: { productId: id }, _sum: { quantity: true } }),
    prisma.stockMovement.findMany({
      where: { productId: id },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { warehouse: { select: { name: true } }, technician: { select: { name: true } } },
    }),
  ]);
  const onHandByWh = new Map(grouped.map((g) => [g.warehouseId, g._sum.quantity ?? 0]));
  const totalOnHand = [...onHandByWh.values()].reduce((s, v) => s + v, 0);
  const unit = uomLabel(product.unitOfMeasure);

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Line of service", value: product.division ? divisionLabel(product.division) : "—" },
    { label: "Subcategory", value: product.subdivision ?? "—" },
    { label: "Category", value: product.category ?? "—" },
    { label: "Manufacturer", value: product.manufacturer ?? "—" },
    { label: "Active ingredient", value: product.activeIngredient ?? "—" },
    { label: "Target pest", value: product.targetPest ?? "—" },
    { label: "Application method", value: product.applicationMethod ?? "—" },
    { label: "Unit of measure", value: `${unit} (${product.unitOfMeasure})` },
    { label: "Units per case", value: product.unitsPerCase != null ? String(product.unitsPerCase) : "—" },
    { label: "EPA reg. no.", value: product.epaRegNumber ?? <span className="text-muted">Not on file</span> },
    { label: "Distributor SKU", value: product.distributorSku ?? "—" },
    { label: "Barcode", value: product.barcode ?? "—" },
  ];

  return (
    <>
      <div className="mb-2">
        <Link href="/manage/products" className="text-xs font-medium text-brand-300 hover:underline">← All products</Link>
      </div>
      <PageHeader
        title={product.name}
        subtitle={[product.manufacturer, product.division ? divisionLabel(product.division) : null].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {product.approved ? (
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">Approved</span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">Off-catalog</span>
            )}
            {product.confirmed ? null : (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">Unconfirmed</span>
            )}
            {product.active ? null : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Inactive</span>}
          </div>
        }
      />

      {/* Safety Data Sheet — prominent, opens the manufacturer SDS PDF. */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-100 text-brand-700">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5M9 13h6M9 17h6" /></svg>
            </span>
            <div>
              <div className="text-sm font-medium text-ink">Safety Data Sheet (SDS / MSDS)</div>
              <div className="text-xs text-muted">{product.sdsUrl ? "Manufacturer document" : "No SDS link on file yet"}</div>
            </div>
          </div>
          {product.sdsUrl ? (
            <a href={product.sdsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-[#05271c] shadow-sm transition hover:brightness-95">
              View SDS
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7M21 3l-9 9M5 5h6M5 5v14h14v-6" /></svg>
            </a>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Product facts */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Product details</div>
          <dl className="divide-y divide-line">
            {facts.map((f) => (
              <div key={f.label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-xs text-muted">{f.label}</dt>
                <dd className="text-sm text-ink text-right">{f.value}</dd>
              </div>
            ))}
          </dl>
          {product.notes ? <p className="border-t border-line px-4 py-3 text-xs text-muted whitespace-pre-line">{product.notes}</p> : null}
        </Card>

        {/* On-hand by branch */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <span className="text-sm font-medium text-ink">On hand by branch</span>
            <span className="text-xs text-muted">{qty(totalOnHand)} {unit} total</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {warehouses.map((w) => {
                const oh = onHandByWh.get(w.id) ?? 0;
                return (
                  <tr key={w.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink">{w.name.replace(" (HQ)", "")}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${oh ? "font-medium text-ink" : "text-muted/50"}`}>{oh ? qty(oh) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Recent movement ledger */}
      <Card className="mt-4 p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Recent movement</div>
        {movements.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No stock movement recorded for this product yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap text-muted">{dateShort(m.createdAt)}</td>
                    <td className="px-3 py-2">{MOVE_LABEL[m.type] ?? m.type}</td>
                    <td className="px-3 py-2 text-muted">{m.warehouse?.name.replace(" (HQ)", "") ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{m.technician?.name ?? m.reason ?? (m.unitPrice != null ? money(m.unitPrice) + "/unit" : "—")}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${m.quantity < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {m.quantity > 0 ? "+" : ""}{qty(m.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
