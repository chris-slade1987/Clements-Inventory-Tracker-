"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type RejectedProduct = {
  id: string; name: string; unitLabel: string; divisionLabel: string;
  distributorSku: string | null; manufacturer: string | null; rejectedNote: string | null;
};

// Rejected (discarded) products — the safety net. Anything rejected from the
// Approve/Reject or Confirm flows lands here (deactivated + removed from check-out,
// history kept). If something was rejected by mistake, Restore brings it back onto
// the catalog (re-approved, unit standardized).
export default function RejectedList({ products }: { products: RejectedProduct[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const visible = products.filter((p) =>
    !needle || [p.name, p.distributorSku, p.manufacturer].filter(Boolean).join(" ").toLowerCase().includes(needle),
  );

  async function restore(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/products/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Could not restore."); setBusyId(null); return; }
      router.refresh();
    } catch {
      setError("Network error. Try again."); setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Products you&apos;ve <strong className="text-red-600">rejected</strong>. They&apos;re off the catalog and out of
        check-out (history is kept). Rejected one by mistake? <strong className="text-brand-700">Restore</strong> brings it
        back onto the catalog, re-approved, with its unit standardized.
      </p>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name / SKU…"
        className="w-full rounded-lg border border-line px-3 py-2 text-sm"
      />

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      <Card className="p-0 overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">{products.length === 0 ? "Nothing rejected. Anything you reject will appear here so you can undo it." : "No matches."}</div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((p) => {
              const busy = busyId === p.id;
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-[11px] text-muted">
                      {p.unitLabel}{p.divisionLabel && p.divisionLabel !== "—" ? ` · ${p.divisionLabel}` : ""}{p.distributorSku ? ` · SKU ${p.distributorSku}` : ""}
                      {p.rejectedNote ? ` · ${p.rejectedNote}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => restore(p.id)}
                    disabled={busy}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${busy ? "opacity-60" : ""} bg-emerald-grad text-white hover:brightness-95`}
                  >
                    {busy ? "…" : "Restore"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
