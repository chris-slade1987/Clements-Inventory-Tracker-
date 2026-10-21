"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type ReviewProduct = {
  id: string; name: string; approved: boolean; confirmed: boolean;
  unitLabel: string; divisionLabel: string; distributorSku: string | null;
  manufacturer: string | null; onHand: number; allCaps: boolean; inInvoices: boolean;
};

// The whole catalog as a flat APPROVE / REJECT list. Go down the list and decide
// each product: Approve keeps it on the catalog; Reject (get rid of) deactivates it
// and removes it from check-out (history kept). Invoice-backed products are flagged
// and sorted to the top; the "Not in invoices" ones are the usual reject candidates.
export default function ReviewAll({ products }: { products: ReviewProduct[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hideApproved, setHideApproved] = useState(true);
  const [onlyNonInvoice, setOnlyNonInvoice] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decidedCount = products.filter((p) => p.approved && p.confirmed).length;

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (hideApproved && p.approved && p.confirmed) return false;
      if (onlyNonInvoice && p.inInvoices) return false;
      if (needle) {
        const hay = [p.name, p.distributorSku, p.manufacturer].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [products, q, hideApproved, onlyNonInvoice]);

  async function decide(id: string, action: "approve" | "discard") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/products/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Action failed."); setBusyId(null); return; }
      router.refresh();
    } catch {
      setError("Network error. Try again."); setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Every product, one row each. <strong className="text-brand-700">Approve</strong> the real ones (keeps them on the
        catalog and checkout-able); <strong className="text-red-600">Reject</strong> anything that isn&apos;t a real product,
        isn&apos;t on your invoices, or is a duplicate (it&apos;s deactivated and removed from check-out — history kept).
        Items backed by invoice data are tagged <span className="rounded bg-brand-50 px-1 text-[11px] font-medium text-brand-700">In invoices</span> and listed first.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / SKU…"
          className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-1.5 text-sm text-muted"><input type="checkbox" checked={hideApproved} onChange={(e) => setHideApproved(e.target.checked)} /> Hide approved</label>
        <label className="flex items-center gap-1.5 text-sm text-muted"><input type="checkbox" checked={onlyNonInvoice} onChange={(e) => setOnlyNonInvoice(e.target.checked)} /> Only &ldquo;not in invoices&rdquo;</label>
        <span className="ml-auto text-xs text-muted">{decidedCount} approved · {visible.length} shown</span>
      </div>

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <Card className="p-0 overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">Nothing to show. {hideApproved ? "Every product has been decided — untick “Hide approved” to see them." : ""}</div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((p) => {
              const busy = busyId === p.id;
              const cataloged = p.approved && p.confirmed;
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{p.name}</span>
                      {p.inInvoices ? (
                        <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">In invoices</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Not in invoices</span>
                      )}
                      {p.allCaps ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">ALL-CAPS</span> : null}
                      {cataloged ? <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">Approved</span> : null}
                    </div>
                    <div className="text-[11px] text-muted">
                      {p.unitLabel}{p.divisionLabel && p.divisionLabel !== "—" ? ` · ${p.divisionLabel}` : ""}{p.distributorSku ? ` · SKU ${p.distributorSku}` : ""} · {p.onHand} on hand
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => decide(p.id, "approve")}
                      disabled={busy || cataloged}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${cataloged ? "bg-brand-50 text-brand-700" : "bg-emerald-grad text-white hover:brightness-95"} disabled:opacity-60`}
                    >
                      {cataloged ? "Approved" : busy ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => decide(p.id, "discard")}
                      disabled={busy}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
