import { Card, EmptyState } from "@/components/ui";
import { dispersalsDetail, type ReportFilters } from "@/lib/reporting";
import { money, qty, dateShort } from "@/lib/format";
import { uomLabel } from "@/lib/uom";

/**
 * Dispersals (check-out) detail — one row per check_out movement (shown as
 * absolute units), with a by-technician rollup above the line-item list. Est.
 * value = abs qty × product cost.
 */
export default async function DispersalsView({
  filters,
  cost,
}: {
  filters: ReportFilters;
  cost: Map<string, number>;
}) {
  const detail = await dispersalsDetail(filters, cost);

  if (detail.lines.length === 0) {
    return (
      <EmptyState
        title="No dispersals match these filters"
        hint="Check-outs to technicians in this date range, branch, and technician appear here."
      />
    );
  }

  return (
    <>
      <Card className="p-0 overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">By technician</h2>
          <span className="text-xs text-muted">Est. value at product cost</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Technician</th>
                <th className="px-2 py-2 font-medium text-right">Lines</th>
                <th className="px-2 py-2 font-medium text-right">Units</th>
                <th className="px-4 py-2 font-medium text-right">Est. value</th>
              </tr>
            </thead>
            <tbody>
              {detail.byTech.map((t) => (
                <tr key={t.technicianId ?? "none"} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{t.technician}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{t.lines}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{qty(t.units)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(t.value)}</td>
                </tr>
              ))}
              <tr className="bg-brand-50/40">
                <td className="px-4 py-2 font-medium text-ink">Total</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{detail.lines.length}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{qty(detail.totalUnits)}</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(detail.totalValue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Line items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Branch</th>
                <th className="px-2 py-2 font-medium">Technician</th>
                <th className="px-2 py-2 font-medium">Product</th>
                <th className="px-2 py-2 font-medium text-right">Qty</th>
                <th className="px-2 py-2 font-medium">Unit</th>
                <th className="px-4 py-2 font-medium text-right">Est. value</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">{dateShort(l.date)}</td>
                  <td className="px-2 py-2 text-muted">{l.warehouseName.replace(" (HQ)", "")}</td>
                  <td className="px-2 py-2">{l.technician}</td>
                  <td className="px-2 py-2">{l.product}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{qty(l.qty)}</td>
                  <td className="px-2 py-2 text-muted">{uomLabel(l.unit) || "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(l.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
