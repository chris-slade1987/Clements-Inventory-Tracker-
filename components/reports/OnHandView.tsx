import { Card, EmptyState } from "@/components/ui";
import { onHandSnapshot, type ReportFilters } from "@/lib/reporting";
import { money, qty, dateShort } from "@/lib/format";
import { onHandMatrix } from "@/lib/inventory";
import { uomLabel } from "@/lib/uom";
import { EditableOnHand, UpdateOtherProduct } from "./OnHandEdit";

/**
 * On-hand snapshot — point-in-time on-hand per product per branch with $ value.
 * On-hand as of a date = SUM(quantity) of movements with createdAt <= asOf.
 */
export default async function OnHandView({
  filters,
  warehouses,
  cost,
  editableWarehouseIds = [],
  products = [],
}: {
  filters: ReportFilters;
  warehouses: { id: string; name: string }[];
  cost: Map<string, number>;
  /** Warehouses whose figures the viewer may update (today's view only; empty = read-only). */
  editableWarehouseIds?: string[];
  products?: { id: string; name: string; unit: string }[];
}) {
  const snapshot = await onHandSnapshot(
    {
      asOf: filters.asOf,
      warehouseId: filters.warehouseId,
      category: filters.category,
      productId: filters.productId,
    },
    cost
  );

  const editable = new Set(editableWarehouseIds);
  const editWarehouses = warehouses.filter((w) => editable.has(w.id));
  let liveOnHand: Record<string, Record<string, number>> = {};
  if (editWarehouses.length) {
    const matrix = await onHandMatrix(); // warehouseId → productId → qty
    const out: Record<string, Record<string, number>> = {};
    for (const [wid, m] of matrix) for (const [pid, q] of m) (out[pid] ??= {})[wid] = q;
    liveOnHand = out;
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          On-hand as of <span className="font-medium text-ink">{dateShort(snapshot.asOf)}</span> · value at latest known unit cost.
          {editWarehouses.length ? <> Tap a branch&apos;s number to update it to what&apos;s on the shelf.</> : null}
        </p>
        {editWarehouses.length ? <UpdateOtherProduct products={products} warehouses={editWarehouses} onHand={liveOnHand} /> : null}
      </div>

      {snapshot.rows.length === 0 ? (
        <EmptyState title="No on-hand stock" hint="No products have stock as of this date for these filters." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 font-medium">Unit</th>
                  {warehouses.map((w) => (
                    <th key={w.id} className="px-2 py-2 font-medium text-right">
                      {w.name.replace(" (HQ)", "")}
                    </th>
                  ))}
                  <th className="px-2 py-2 font-medium text-right">Total qty</th>
                  <th className="px-2 py-2 font-medium text-right">Unit cost</th>
                  <th className="px-4 py-2 font-medium text-right">Total value</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.map((r) => (
                  <tr key={r.productId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-2 py-2 text-muted">{r.category}</td>
                    <td className="px-2 py-2 text-muted">{r.unit}</td>
                    {warehouses.map((w) => (
                      <td key={w.id} className="px-2 py-2 text-right tabular-nums">
                        {editable.has(w.id) ? (
                          <EditableOnHand productId={r.productId} productName={r.name} warehouseId={w.id} warehouseName={w.name}
                            current={liveOnHand[r.productId]?.[w.id] ?? r.byWarehouse[w.id] ?? 0} unit={uomLabel(r.unit) || r.unit} />
                        ) : r.byWarehouse[w.id] ? qty(r.byWarehouse[w.id]) : "—"}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{qty(r.totalQty)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.unitCost ? money(r.unitCost) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(r.totalValue)}</td>
                  </tr>
                ))}
                <tr className="bg-brand-50/40">
                  <td className="px-4 py-2 font-medium text-ink" colSpan={3}>
                    Grand total
                  </td>
                  {warehouses.map((w) => (
                    <td key={w.id} className="px-2 py-2 text-right font-semibold tabular-nums">
                      {money(snapshot.byWarehouseValue[w.id]?.value ?? 0)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{qty(snapshot.grandTotalQty)}</td>
                  <td className="px-2 py-2" />
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(snapshot.grandTotalValue)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
