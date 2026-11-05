"use client";

import { useMemo, useState } from "react";
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

export type MergeTarget = { id: string; name: string; manufacturer: string | null };

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

// Decide new-product approval requests. Three options per request:
//   • Create a new product  — catalogs it from the REVIEWED fields (AI-filled,
//     correctable), attaches photos, posts the on-hand count.
//   • Merge into existing   — folds the request into a product that already exists
//     (no duplicate; the variant resolves next time — the learning loop).
//   • Reject                — asks for a reason, notifies the requester.
// All three carry through to /api/inventory/product-request.
export default function ProductRequestsClient({
  requests,
  mergeTargets,
}: {
  requests: ProductRequestRow[];
  mergeTargets: MergeTarget[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(requests.map((r) => [r.id, draftFor(r)])),
  );
  const [denying, setDenying] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState<string>("");

  const setField = (id: string, k: keyof Draft, v: string) =>
    setDrafts((m) => ({ ...m, [id]: { ...m[id], [k]: v } }));

  const filteredTargets = useMemo(() => {
    const q = mergeQuery.trim().toLowerCase();
    // Show the WHOLE approved list (scrollable) when there's no search — never cap
    // it, or targets past the cap (e.g. PT Microcare, alphabetically after the first
    // page) become unreachable without typing a search.
    return q
      ? mergeTargets.filter((t) => t.name.toLowerCase().includes(q) || (t.manufacturer ?? "").toLowerCase().includes(q))
      : mergeTargets;
  }, [mergeQuery, mergeTargets]);

  function openMerge(id: string) {
    setDenying(null);
    setMerging(id);
    setMergeQuery("");
    setMergeTargetId("");
    setError(null);
  }

  async function decide(id: string, action: "approve" | "deny" | "merge") {
    const d = drafts[id];
    if (action === "merge" && !mergeTargetId) {
      setError("Pick an existing product to merge into.");
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const payload =
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
          : action === "merge"
            ? {
                action, id,
                targetProductId: mergeTargetId,
                onHandQty: d.onHandQty === "" ? undefined : d.onHandQty,
                note: d.note.trim() || undefined,
              }
            : { action, id, note: d.note.trim() || undefined };
      const res = await fetch("/api/inventory/product-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        const isMerging = merging === r.id;
        const d = drafts[r.id];
        if (!d) return null;
        const chosen = mergeTargets.find((t) => t.id === mergeTargetId);
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

            {/* Editable new-product form (AI-filled, correctable). Hidden while
                merging — a merge uses the existing product's fields, not these. */}
            {!isMerging ? (
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
            ) : null}

            {/* Merge panel — pick an existing approved product to fold this into. */}
            {isMerging ? (
              <div className="space-y-2 rounded-xl border border-line bg-surface/60 p-3">
                <div className="text-sm font-medium text-ink">Merge &ldquo;{r.proposedName}&rdquo; into an existing product</div>
                <input
                  value={mergeQuery}
                  onChange={(e) => setMergeQuery(e.target.value)}
                  placeholder="Search the approved catalog…"
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
                <select
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  size={Math.min(8, Math.max(3, filteredTargets.length))}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
                >
                  {filteredTargets.length === 0 ? <option value="">No matches</option> : null}
                  {filteredTargets.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.manufacturer ? ` — ${t.manufacturer}` : ""}</option>
                  ))}
                </select>
                <label className="block text-sm font-medium">On-hand to post to the target{r.branchLabel ? ` (${r.branchLabel})` : ""}
                  <input type="number" min={0} value={d.onHandQty} onChange={(e) => setField(r.id, "onHandQty", e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
                </label>
                <p className="text-[11px] text-muted">
                  {chosen
                    ? `This request will be folded into "${chosen.name}". Any history on the requested item moves onto it, its barcode is remembered for next time, and ${d.onHandQty && Number(d.onHandQty) > 0 ? `${d.onHandQty} on hand is posted` : "no on-hand is posted"}.`
                    : "Pick the catalog product this is really the same as."}
                </p>
              </div>
            ) : null}

            {isDenying ? (
              <label className="block text-sm font-medium">Reason for rejection (sent to {r.requestedByName})
                <textarea value={d.note} onChange={(e) => setField(r.id, "note", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              {isMerging ? (
                <>
                  <button onClick={() => decide(r.id, "merge")} disabled={busy || !mergeTargetId} className={btn.primary}>
                    {busy ? "Merging…" : "Confirm merge"}
                  </button>
                  <button onClick={() => setMerging(null)} disabled={busy} className={btn.secondary}>Cancel</button>
                </>
              ) : isDenying ? (
                <>
                  <button onClick={() => decide(r.id, "deny")} disabled={busy} className={btn.danger}>Confirm reject</button>
                  <button onClick={() => setDenying(null)} disabled={busy} className={btn.secondary}>Cancel</button>
                </>
              ) : (
                <>
                  <button onClick={() => decide(r.id, "approve")} disabled={busy} className={btn.primary}>
                    {busy ? "Saving…" : "Create new product"}
                  </button>
                  <button onClick={() => openMerge(r.id)} disabled={busy} className={btn.secondary}>Merge into existing…</button>
                  <button onClick={() => { setMerging(null); setDenying(r.id); }} disabled={busy} className="text-sm font-medium text-muted hover:text-red-600">Reject…</button>
                </>
              )}
            </div>
            {!isMerging && !isDenying ? (
              <p className="text-[11px] text-muted">
                <span className="font-medium">Create</span> catalogs a brand-new product from the fields above
                {d.onHandQty && Number(d.onHandQty) > 0 ? ` (posts ${d.onHandQty} on hand)` : " (no on-hand — quantity blank)"}.
                {" "}<span className="font-medium">Merge</span> folds it into a product that already exists.
                {" "}<span className="font-medium">Reject</span> declines it with a reason.
              </p>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
