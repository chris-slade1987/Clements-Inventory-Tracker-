"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, EmptyState, btn } from "@/components/ui";
import { uomLabel } from "@/lib/uom";

const UNDO_WINDOW_MS = 15 * 60 * 1000;

type Line = { name: string; quantity: number; unit: string; identifiedBy: string; photoUrl: string | null };
type Checkout = {
  id: string;
  warehouse: string;
  technician: string;
  issuedBy: string;
  issuedByUserId: string;
  status: string;
  submittedAt: string;
  voidReason: string | null;
  lines: Line[];
};

export default function HistoryClient({
  isAdmin,
  userId,
  branchFilter,
  warehouses,
  checkouts,
}: {
  isAdmin: boolean;
  userId: string;
  branchFilter: string | null;
  warehouses: { id: string; name: string }[];
  checkouts: Checkout[];
}) {
  const router = useRouter();
  // Captured once on mount so the undo-window check is stable across re-renders.
  const [nowMs] = useState(() => Date.now());
  const [tech, setTech] = useState("");
  const [product, setProduct] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // In-page void confirmation (replaces window.prompt/confirm).
  const [voidModal, setVoidModal] = useState<{ checkout: Checkout; needReason: boolean } | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const filtered = useMemo(() => {
    const t = tech.trim().toLowerCase();
    const p = product.trim().toLowerCase();
    const fromT = from ? new Date(from).getTime() : null;
    const toT = to ? new Date(to).getTime() + 86_400_000 : null;
    return checkouts.filter((c) => {
      if (t && !c.technician.toLowerCase().includes(t)) return false;
      if (p && !c.lines.some((l) => l.name.toLowerCase().includes(p))) return false;
      const at = new Date(c.submittedAt).getTime();
      if (fromT && at < fromT) return false;
      if (toT && at >= toT) return false;
      return true;
    });
  }, [checkouts, tech, product, from, to]);

  function canUndo(c: Checkout): { allowed: boolean; needReason: boolean } {
    if (c.status === "VOIDED") return { allowed: false, needReason: false };
    const within = nowMs - new Date(c.submittedAt).getTime() <= UNDO_WINDOW_MS;
    if (within) return { allowed: isAdmin || c.issuedByUserId === userId, needReason: false };
    return { allowed: isAdmin, needReason: true };
  }

  function openVoid(c: Checkout) {
    const { needReason } = canUndo(c);
    setVoidReason("");
    setError(null);
    setVoidModal({ checkout: c, needReason });
  }

  async function confirmVoid() {
    if (!voidModal) return;
    const c = voidModal.checkout;
    const reason = voidReason.trim();
    if (voidModal.needReason && !reason) {
      setError("A reason is required to void after 15 minutes.");
      return;
    }
    setBusy(c.id);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/checkout/${c.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voidReason: reason || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(null);
      if (!res.ok) {
        setError(data.error ?? "Could not void.");
        return;
      }
      setVoidModal(null);
      router.refresh();
    } catch {
      setBusy(null);
      setError("Network error.");
    }
  }

  function exportCsv() {
    const rows: string[][] = [["Checkout", "Date", "Branch", "Technician", "Issued by", "Status", "Product", "Quantity", "Unit", "Identified by"]];
    for (const c of filtered) {
      for (const l of c.lines) {
        rows.push([c.id, new Date(c.submittedAt).toISOString(), c.warehouse, c.technician, c.issuedBy, c.status, l.name, String(l.quantity), l.unit, l.identifiedBy]);
      }
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `checkout-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function setBranch(id: string) {
    router.push(id ? `/inventory/history?branch=${id}` : "/inventory/history");
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isAdmin ? (
          <div>
            <label className="block text-xs font-medium mb-1">Branch</label>
            <select value={branchFilter ?? ""} onChange={(e) => setBranch(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              <option value="">All branches</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        ) : null}
        <div>
          <label className="block text-xs font-medium mb-1">Technician</label>
          <input value={tech} onChange={(e) => setTech(e.target.value)} placeholder="Name…" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Product</label>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Name…" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium mb-1">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-line px-2 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-line px-2 py-2 text-sm" />
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted">{filtered.length} checkout{filtered.length === 1 ? "" : "s"}</div>
        <button className={btn.secondary} onClick={exportCsv} disabled={filtered.length === 0}>Export CSV</button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {filtered.length === 0 ? (
        <EmptyState title="No checkouts" hint="Scan-to-issue checkouts will appear here." />
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const { allowed } = canUndo(c);
            const voided = c.status === "VOIDED";
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{c.technician} <span className="text-muted font-normal">· {c.warehouse}</span></div>
                    <div className="text-xs text-muted">{new Date(c.submittedAt).toLocaleString()} · by {c.issuedBy}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${voided ? "bg-red-100 text-red-700" : "bg-brand-50 text-brand-700"}`}>
                    {voided ? "Voided" : "Submitted"}
                  </span>
                </div>
                <div className="mt-2 divide-y divide-line border-t border-line">
                  {c.lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        {l.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.photoUrl} alt="" className="h-8 w-8 rounded object-cover border border-line" />
                        ) : null}
                        <span className="truncate">{l.name}</span>
                      </span>
                      <span className="shrink-0 font-medium">{l.quantity} {uomLabel(l.unit)}</span>
                    </div>
                  ))}
                </div>
                {voided && c.voidReason ? <p className="mt-2 text-xs text-muted">Reason: {c.voidReason}</p> : null}
                {allowed ? (
                  <div className="mt-3">
                    <button className={btn.danger} onClick={() => openVoid(c)} disabled={busy === c.id}>
                      {busy === c.id ? "Voiding…" : "Undo / Void"}
                    </button>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {voidModal ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => (busy ? undefined : setVoidModal(null))}>
          <div className="surface-light w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Undo / void checkout</h3>
            <p className="text-sm text-muted">
              {voidModal.checkout.technician} · {voidModal.checkout.warehouse}. Stock will be returned with offsetting adjustments — nothing is deleted.
            </p>
            <label className="block text-sm font-medium">
              Reason{voidModal.needReason ? " (required)" : " (optional)"}
              <input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder={voidModal.needReason ? "Required after 15 minutes" : "e.g. wrong technician, miscount"}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                autoFocus
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setVoidModal(null)} className={btn.secondary} disabled={!!busy}>Cancel</button>
              <button onClick={confirmVoid} disabled={!!busy || (voidModal.needReason && !voidReason.trim())} className={`${btn.danger} flex-1`}>
                {busy ? "Voiding…" : "Undo / Void"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
