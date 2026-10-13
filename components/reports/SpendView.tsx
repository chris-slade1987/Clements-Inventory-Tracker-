import { Card, EmptyState } from "@/components/ui";
import {
  spendByCategory,
  spendByDistributor,
  spendMonthlyTrend,
  type ReportFilters,
} from "@/lib/reporting";
import { money } from "@/lib/format";
import GroupedBarChart from "@/components/GroupedBarChart";

/**
 * Spend by distributor / category — ranked spend tables plus a monthly purchase-$
 * trend. Sourced from confirmed invoice lines within the invoiceDate range.
 */
export default async function SpendView({ filters }: { filters: ReportFilters }) {
  const from = filters.from ?? new Date(0);
  const to = filters.to;
  const [byDistributor, byCategory, trend] = await Promise.all([
    spendByDistributor(from, to, filters.warehouseId, filters.distributor),
    spendByCategory(from, to, filters.warehouseId, filters.distributor),
    spendMonthlyTrend(from, to, filters.warehouseId, filters.distributor),
  ]);

  const distributorTotal = byDistributor.reduce((s, r) => s + r.total, 0);
  const categoryTotal = byCategory.reduce((s, r) => s + r.value, 0);

  if (byDistributor.length === 0 && byCategory.length === 0) {
    return (
      <EmptyState
        title="No spend in this range"
        hint="Confirmed purchases in the selected date range and branch appear here."
      />
    );
  }

  const trendGroups = trend.map((t) => ({ label: t.label, values: { total: t.total } }));

  return (
    <>
      <Card className="p-4 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-2">Monthly purchase spend</h2>
        {trend.length === 0 ? (
          <p className="text-sm text-muted">No invoices in this range.</p>
        ) : (
          <GroupedBarChart
            groups={trendGroups}
            series={[{ key: "total", label: "Purchase $", color: "#0b6b45" }]}
            formatValue={(n) => money(n)}
          />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">Spend by distributor</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Distributor</th>
                  <th className="px-2 py-2 font-medium text-right">Invoices</th>
                  <th className="px-4 py-2 font-medium text-right">Total $</th>
                </tr>
              </thead>
              <tbody>
                {byDistributor.map((d) => (
                  <tr key={d.distributor} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{d.distributor}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{d.invoices}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(d.total)}</td>
                  </tr>
                ))}
                <tr className="bg-brand-50/40">
                  <td className="px-4 py-2 font-medium text-ink" colSpan={2}>
                    Total
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(distributorTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">Spend by category</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium text-right">Total $</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((c) => (
                  <tr key={c.key} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{c.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(c.value)}</td>
                  </tr>
                ))}
                <tr className="bg-brand-50/40">
                  <td className="px-4 py-2 font-medium text-ink">Total</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(categoryTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
