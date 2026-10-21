"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { dateShort } from "@/lib/format";
import type { ProductRequestRow } from "@/lib/product-requests";

// Approve / deny new-product requests. Approving catalogs the product (an edited
// name carries through) and notifies the requester; denying asks for a reason.
export default function ProductRequestsClient({ requests }: { requests: ProductRequestRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(requests.map((r) => [r.id, r.proposedName])),
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [denying, setDenying] = useState<string | null>(null);

  async function decide(id: string, action: "approve" | "deny") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/inventory/product-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, name: names[id]?.trim() || undefined, note: notes[id]?.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Action failed."); setBusyId(null); return; }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {requests.map((r) => {
        const busy = busyId === r.id;
        const isDenying = denying === r.id;
        return (
          <Card key={r.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted">
                  Requested by {r.requestedByName}
                  {r.branchLabel ? ` · ${r.branchLabel}` : ""} · {dateShort(r.createdAt)}
                </div>
                {r.reason ? <div className="mt-1 text-sm text-ink">{r.reason}</div> : null}
                {r.manufacturer || r.distributorSku ? (
                  <div className="mt-0.5 text-[11px] text-muted">
                    {r.manufacturer ?? ""}{r.manufacturer && r.distributorSku ? " · " : ""}{r.distributorSku ? `SKU ${r.distributorSku}` : ""}
                  </div>
                ) : null}
                {r.productId ? <div className="mt-0.5 text-[11px] text-muted">Linked to an existing off-catalog product.</div> : null}
              </div>
              {r.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover border border-line" />
              ) : null}
            </div>

            <label className="block text-sm font-medium">
              Catalog name
              <input
                value={names[r.id] ?? ""}
                onChange={(e) => setNames((m) => ({ ...m, [r.id]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </label>

            {isDenying ? (
              <label className="block text-sm font-medium">
                Reason for denial (sent to {r.requestedByName})
                <textarea
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes((m) => ({ ...m, [r.id]: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <button onClick={() => decide(r.id, "approve")} disabled={busy} className={btn.primary}>
                {busy ? "Saving…" : "Approve & catalog"}
              </button>
              {isDenying ? (
                <>
                  <button onClick={() => decide(r.id, "deny")} disabled={busy} className={btn.danger}>Confirm deny</button>
                  <button onClick={() => setDenying(null)} disabled={busy} className={btn.secondary}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setDenying(r.id)} disabled={busy} className="text-sm font-medium text-muted hover:text-red-600">Deny…</button>
              )}
            </div>
            <p className="text-[11px] text-muted">
              Approving creates the product with unit <strong>Each</strong> — set the real unit / classification in the Products catalog.
            </p>
          </Card>
        );
      })}
    </div>
  );
}
