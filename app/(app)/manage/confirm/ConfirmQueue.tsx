"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn, UnitSelect } from "@/components/ui";
import { DIVISIONS, DIVISION_LABELS, SUBDIVISIONS, type Division } from "@/lib/constants";

type Pending = {
  id: string;
  name: string;
  division: string | null;
  subdivision: string | null;
  divisionLabel: string;
  unitOfMeasure: string;
  unitLabel: string;
  unitsPerCase: number | null;
  category: string | null;
  manufacturer: string | null;
  notes: string | null;
  distributorSku: string | null;
};

type Edit = {
  name: string;
  division: string;
  subdivision: string;
  unitOfMeasure: string;
  unitsPerCase: string;
};

export default function ConfirmQueue({
  products,
  confirmedProducts,
}: {
  products: Pending[];
  confirmedProducts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Edit>>(() =>
    Object.fromEntries(
      products.map((p) => [
        p.id,
        {
          name: p.name,
          division: p.division ?? "",
          subdivision: p.subdivision ?? "",
          unitOfMeasure: p.unitOfMeasure,
          unitsPerCase: p.unitsPerCase == null ? "" : String(p.unitsPerCase),
        },
      ])
    )
  );
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(id: string, p: Partial<Edit>) {
    setEdits((prev) => {
      const next = { ...prev[id], ...p };
      // A division change invalidates a subdivision that no longer belongs.
      if (p.division !== undefined) {
        const subs = SUBDIVISIONS[p.division as Division] ?? [];
        if (!subs.includes(next.subdivision)) next.subdivision = "";
      }
      return { ...prev, [id]: next };
    });
  }

  async function post(body: Record<string, unknown>, id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/products/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Action failed.");
        setBusyId(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
      setBusyId(null);
    }
  }

  function confirm(p: Pending) {
    const e = edits[p.id];
    post({ action: "confirm", id: p.id, ...e }, p.id);
  }

  function merge(p: Pending) {
    const targetId = mergeTarget[p.id];
    if (!targetId) {
      setError("Pick a product to merge into.");
      return;
    }
    post({ action: "merge", id: p.id, targetId }, p.id);
  }

  function discard(p: Pending) {
    if (!window.confirm(`Discard "${p.name}"? It won't appear in the catalog or at check-out. Its history is kept and it can be reactivated later if needed.`)) return;
    post({ action: "discard", id: p.id }, p.id);
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {products.map((p) => {
        const e = edits[p.id];
        const subs = SUBDIVISIONS[e.division as Division] ?? [];
        const busy = busyId === p.id;
        return (
          <Card key={p.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-muted">
                  {p.category ?? "—"}
                  {p.manufacturer ? ` · ${p.manufacturer}` : ""}
                  {p.distributorSku ? ` · SKU ${p.distributorSku}` : ""}
                </div>
                {p.notes ? <div className="mt-0.5 text-[11px] text-amber-700">{p.notes}</div> : null}
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                Unconfirmed
              </span>
            </div>

            <label className="block text-sm font-medium">
              Name
              <input
                value={e.name}
                onChange={(ev) => patch(p.id, { name: ev.target.value })}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Division
                <select
                  value={e.division}
                  onChange={(ev) => patch(p.id, { division: ev.target.value })}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
                >
                  <option value="">— Select —</option>
                  {DIVISIONS.map((d) => (
                    <option key={d} value={d}>{DIVISION_LABELS[d]} ({d})</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Subdivision
                <select
                  value={e.subdivision}
                  onChange={(ev) => patch(p.id, { subdivision: ev.target.value })}
                  disabled={!e.division}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface disabled:opacity-50"
                >
                  <option value="">— Select —</option>
                  {subs.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Unit of measure
                <UnitSelect
                  value={e.unitOfMeasure}
                  onChange={(code) => patch(p.id, { unitOfMeasure: code })}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
                />
              </label>
              <label className="block text-sm font-medium">
                Units per case
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={e.unitsPerCase}
                  onChange={(ev) => patch(p.id, { unitsPerCase: ev.target.value })}
                  placeholder="—"
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <button onClick={() => confirm(p)} disabled={busy} className={btn.primary}>
                {busy ? "Saving…" : "Confirm product"}
              </button>
              <button onClick={() => discard(p)} disabled={busy} className={btn.danger} title="Remove from the catalog & check-out (history kept)">
                Discard
              </button>
              <div className="ml-auto flex items-center gap-2">
                <select
                  value={mergeTarget[p.id] ?? ""}
                  onChange={(ev) => setMergeTarget((m) => ({ ...m, [p.id]: ev.target.value }))}
                  className="max-w-[12rem] rounded-lg border border-line px-2 py-2 text-sm bg-surface"
                >
                  <option value="">Merge into…</option>
                  {confirmedProducts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button onClick={() => merge(p)} disabled={busy || !mergeTarget[p.id]} className={btn.secondary}>
                  Merge
                </button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
