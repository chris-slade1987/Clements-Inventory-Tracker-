import { redirect } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { dateShort } from "@/lib/format";
import { listProductRequests } from "@/lib/product-requests";
import ProductRequestsClient from "./ProductRequestsClient";

export const dynamic = "force-dynamic";

// Super-admin-only queue of new-product approval requests raised at Check-Out
// (rep samples / off-catalog items). Approving catalogs the product so it becomes
// checkout-eligible and notifies the requester. See /api/inventory/product-request.
export default async function ProductRequestsPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/manage/products");

  const { pending, decided } = await listProductRequests(50);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        When a manager tries to check out a product that isn&apos;t on the approved catalog (a rep sample, or
        anything that never came in on an invoice), they send it here. Any super admin can approve it — the
        product becomes checkout-eligible and the requester is notified they can dispense it.
      </p>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Awaiting your decision {pending.length > 0 ? `(${pending.length})` : ""}</h2>
        {pending.length === 0 ? (
          <EmptyState title="No pending requests" hint="New-product requests from Check-Out will appear here for approval." />
        ) : (
          <ProductRequestsClient requests={pending} />
        )}
      </section>

      {decided.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Recently decided</h2>
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Requested by</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                  <th className="px-4 py-2 font-medium text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.proposedName}</div>
                      {r.branchLabel ? <div className="text-[11px] text-muted">{r.branchLabel}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{r.requestedByName}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {r.status === "approved" ? "Approved" : "Denied"}
                      </span>
                      {r.decidedByName ? <span className="ml-2 text-[11px] text-muted">by {r.decidedByName}</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right text-muted">{r.decidedAt ? dateShort(r.decidedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
