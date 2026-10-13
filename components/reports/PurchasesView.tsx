import { Card, EmptyState } from "@/components/ui";
import { purchasesDetail, type ReportFilters } from "@/lib/reporting";
import { money, qty, dateShort } from "@/lib/format";
import { uomLabel } from "@/lib/uom";

/**
 * Purchases (check-in) detail — confirmed distributor receipts, one row per
 * invoice line, grouped by invoice with invoice subtotals, per-branch subtotals,
 * and a grand total in dollars.
 */
export default async function PurchasesView({ filters }: { filters: ReportFilters }) {
  const detail = await purchasesDetail(filters);

  if (detail.invoices.length === 0) {
    return (
      <EmptyState
        title="No purchases match these filters"
        hint="Confirmed distributor receipts in this date range, branch, and distributor appear here."
      />
    );
  }

  return (
    <>
      {detail.invoices.map((inv) => (
        <Card key={inv.invoiceId} className="p-0 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-semibold text-ink">{inv.distributor}</span>
              <span className="text-muted"> · Invoice #{inv.invoiceNumber}</span>
            </div>
            <div className="text-xs text-muted">
              {dateShort(inv.date)} · {inv.warehouseName.replace(" (HQ)", "")}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-2 py-2 font-medium text-right">Qty</th>
                  <th className="px-2 py-2 font-medium">Unit</th>
                  <th className="px-2 py-2 font-medium text-right">Unit cost</th>
                  <th className="px-4 py-2 font-medium text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={`${l.invoiceId}:${l.product}:${l.lineTotal}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      {l.product}
                      {!l.productId ? <span className="ml-1 text-xs text-muted">(unmatched)</span> : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{qty(l.qty)}</td>
                    <td className="px-2 py-2 text-muted">{uomLabel(l.unit) || "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.unitCost == null ? "—" : money(l.unitCost)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(l.lineTotal)}</td>
                  </tr>
                ))}
                <tr className="bg-brand-50/40">
                  <td className="px-4 py-2 font-medium text-ink" colSpan={4}>
                    Invoice subtotal
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(inv.subtotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Totals</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium text-right">Purchases $</th>
              </tr>
            </thead>
            <tbody>
              {detail.byBranch.map((b) => (
                <tr key={b.warehouseId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{b.warehouseName.replace(" (HQ)", "")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(b.subtotal)}</td>
                </tr>
              ))}
              <tr className="bg-brand-50/40">
                <td className="px-4 py-2 font-medium text-ink">Grand total</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(detail.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
