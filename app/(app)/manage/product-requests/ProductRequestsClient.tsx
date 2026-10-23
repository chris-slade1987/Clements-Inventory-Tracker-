"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn, UnitSelect } from "@/components/ui";
import { dateShort } from "@/lib/format";
import { DIVISIONS, divisionLabel } from "@/lib/constants";
import type { ProductRequestRow } from "@/lib/product-requests";

type Draft = {
  name: string;
  manufacturer: string;
  distributorSku: string;
  unitOfMeasure: string;
  division: string;
  description: string;
  onHandQty: string;
  note: string;
};

function draftFor(r: ProductRequestRow): Draft {
  return {
    name: r.proposedName,
    manufacturer: r.manufacturer ?? "",
    distributorSku: r.distributorSku ?? "",
    unitOfMeasure: r.unitOfMeasure ?? "EA",
    division: r.division ?? "",
    description: r.description ?? "",
    onHandQty: r.onHandQty != null ? String(r.onHandQty) : "",
    note: "",
  };
}

// Approve / deny new-product requests. Approving catalogs the product from the
// REVIEWED fields (AI-filled, correctable here), attaches the request's photos,
// and posts the on-hand count as an adjustment at the branch; denying asks for a
// reason. All edits carry through to /api/inventory/product-request.
export default function ProductRequestsClient({ requests }: { requests: ProductRequestRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(requests.map((r) => [r.id, draftFor(r)])),
  );
  const [denying, setDenying] = useState<string | null>(null);

  const setField = (id: string, k: keyof Draft, v: string) =>
    setDrafts((m) => ({ ...m, [id]: { ...m[id], [k]: v } }));

  async function decide(id: string, action: "approve" | "deny") {
    const d = drafts[id];
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/inventory/product-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve"
            ? {
                action, id,
                name: d.name.trim() || undefined,
                manufacturer: d.manufacturer.trim() || undefined,
                distributorSku: d.distributorSku.trim() || undefined,
                unitOfMeasure: d.unitOfMeasure || undefined,
                division: d.division || undefined,
                description: d.description.trim() || undefined,
                onHandQty: d.onHandQty === "" ? undefined : d.onHandQty,
                note: d.note.trim() || undefined,
              }
            : { action, id, note: d.note.trim() || undefined },
        ),
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
        const d = drafts[r.id];
        if (!d) return null;
        return (
          <Card key={r.id} className="space-y-3 p-4">
            <div className="text-xs text-muted">
              Requested by {r.requestedByName}
              {r.branchLabel ? ` · ${r.branchLabel}` : ""} · {dateShort(r.createdAt)}
              {r.productId ? " · linked to an existing off-catalog product" : ""}
            </div>
            {r.reason ? <div className="text-sm text-ink">{r.reason}</div> : null}

            {r.photos.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {r.photos.map((p) => (
                  <div key={p.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.photoUrl} alt={p.kind} className="h-20 w-full rounded-lg border border-line object-cover" />
                    <div className="mt-0.5 text-center text-[10px] capitalize text-muted">{p.kind}</div>
                  </div>
                ))}
              </div>
            ) : r.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.photoUrl} alt="" className="h-20 w-20 rounded-lg border border-line object-cover" />
            ) : null}

            {/* Editable new-product form (AI-filled, correctable). */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium sm:col-span-2">Catalog name
                <input value={d.name} onChange={(e) => setField(r.id, "name", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm font-medium">Manufacturer
                <input value={d.manufacturer} onChange={(e) => setField(r.id, "manufacturer", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm font-medium">Distributor SKU
                <input value={d.distributorSku} onChange={(e) => setField(r.id, "distributorSku", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm font-medium">Unit
                <UnitSelect value={d.unitOfMeasure} onChange={(c) => setField(r.id, "unitOfMeasure", c)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface" />
              </label>
              <label className="block text-sm font-medium">Line of service
                <select value={d.division} onChange={(e) => setField(r.id, "division", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="">—</option>
                  {DIVISIONS.map((x) => <option key={x} value={x}>{divisionLabel(x)}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium sm:col-span-2">Description
                <textarea value={d.description} onChange={(e) => setField(r.id, "description", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm font-medium">On-hand to post{r.branchLabel ? ` (${r.branchLabel})` : ""}
                <input type="number" min={0} value={d.onHandQty} onChange={(e) => setField(r.id, "onHandQty", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
            </div>

            {isDenying ? (
              <label className="block text-sm font-medium">Reason for denial (sent to {r.requestedByName})
                <textarea value={d.note} onChange={(e) => setField(r.id, "note", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
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
              Approving creates the product (approved + confirmed + active) from these fields, attaches the photos, and
              {d.onHandQty && Number(d.onHandQty) > 0 ? ` posts ${d.onHandQty} on hand` : " posts no on-hand (quantity blank)"} at the branch.
            </p>
          </Card>
        );
      })}
    </div>
  );
}
