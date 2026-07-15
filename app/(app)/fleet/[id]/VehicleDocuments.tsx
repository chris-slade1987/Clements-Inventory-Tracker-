"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

export type DocRow = {
  id: string; title: string; category: string; filePath: string | null;
  insurer: string | null; policyNumber: string | null; expirationDate: string | null;
};
type Analysis = {
  category: string; title: string; insurer: string | null; policyNumber: string | null;
  effectiveDate: string | null; expirationDate: string | null; summary: string; source: "claude" | "mock";
};

const CATEGORIES = [
  { key: "insurance", label: "Insurance" },
  { key: "registration", label: "Registration" },
  { key: "title", label: "Title" },
  { key: "bill_of_sale", label: "Bill of sale" },
  { key: "inspection", label: "Inspection / emissions" },
  { key: "other", label: "Other" },
];
const CAT_STYLE: Record<string, string> = {
  insurance: "bg-brand-100 text-brand-700",
  registration: "bg-amber-100 text-amber-700",
  title: "bg-slate-100 text-slate-600",
  bill_of_sale: "bg-emerald-100 text-emerald-700",
  inspection: "bg-emerald-100 text-emerald-700",
  other: "bg-slate-100 text-slate-600",
};
const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? "Other";

export default function VehicleDocuments({
  vehicleId, vehicleLabel, sold, canManage, documents,
}: {
  vehicleId: string; vehicleLabel: string; sold: boolean; canManage: boolean; documents: DocRow[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [mode, setMode] = useState<string>("");
  const [form, setForm] = useState({ category: "other", title: "", insurer: "", policyNumber: "", effectiveDate: "", expirationDate: "", remindHr: true });

  async function onFile(file: File) {
    setBusy(true); setError(null);
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/fleet/document", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return setError(data.error ?? "Upload failed.");
    const a: Analysis = data.analysis;
    setDocId(data.doc.id);
    setMode(data.mode);
    setForm({
      category: a.category ?? "other",
      title: a.title ?? file.name,
      insurer: a.insurer ?? "",
      policyNumber: a.policyNumber ?? "",
      effectiveDate: a.effectiveDate ?? "",
      expirationDate: a.expirationDate ?? "",
      remindHr: true,
    });
    setOpen(true);
  }

  async function confirm() {
    if (!docId) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/fleet/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", id: docId, vehicleId, ...form }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not file.");
    close(); router.refresh();
  }
  async function discard() {
    if (docId) await fetch("/api/fleet/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: docId }) });
    close(); router.refresh();
  }
  function close() { setOpen(false); setDocId(null); setError(null); }
  async function removeDoc(id: string) {
    if (!confirm2("Remove this document? This can't be undone.")) return;
    await fetch("/api/fleet/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    router.refresh();
  }

  return (
    <Card className="p-0 overflow-hidden mb-5">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-ink">Documents</div>
        {canManage ? (
          <div className="flex items-center gap-3">
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="text-xs font-medium text-brand-700 hover:underline">{busy && !open ? "Reading…" : "+ Upload"}</button>
            <input ref={fileRef} type="file" accept=".pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </div>
        ) : null}
      </div>

      {sold ? (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">This vehicle is out of service — attach the <strong>bill of sale</strong> and any transfer documents for the record.</div>
      ) : null}
      {error && !open ? <p className="px-4 py-2 text-sm text-red-600">{error}</p> : null}

      {documents.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">No documents on file. Upload insurance, registration, title, or a bill of sale — the reader fills in the details.</p>
      ) : (
        <ul className="divide-y divide-line">
          {documents.map((d) => {
            const exp = d.expirationDate ? new Date(d.expirationDate) : null;
            const soon = exp != null && exp.getTime() - Date.now() <= 45 * 864e5;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CAT_STYLE[d.category] ?? "bg-slate-100 text-slate-600"}`}>{catLabel(d.category)}</span>
                {d.filePath ? <a href={d.filePath} target="_blank" className="text-sm font-medium text-brand-700 hover:underline">{d.title}</a> : <span className="text-sm font-medium text-ink">{d.title}</span>}
                {d.insurer ? <span className="text-xs text-muted">{d.insurer}{d.policyNumber ? ` · ${d.policyNumber}` : ""}</span> : null}
                {exp ? <span className={`text-xs font-medium ${exp.getTime() < Date.now() ? "text-red-600" : soon ? "text-amber-600" : "text-muted"}`}>renews {exp.toLocaleDateString()}</span> : null}
                {canManage ? <button onClick={() => removeDoc(d.id)} className="ml-auto text-xs text-muted hover:text-red-600">Remove</button> : null}
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">File document</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${mode === "claude" ? "bg-brand-100 text-brand-700" : "bg-amber-100 text-amber-700"}`}>{mode === "claude" ? "AI read" : "Manual"}</span>
            </div>
            <p className="text-xs text-muted">Filing to <span className="font-medium text-ink">{vehicleLabel}</span>.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">Category
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Renewal / expiration
                <input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
              </label>
              <label className="block text-sm font-medium sm:col-span-2">Title
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm font-medium">Insurer / issuer
                <input value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm font-medium">Policy / doc #
                <input value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={form.remindHr} onChange={(e) => setForm({ ...form, remindHr: e.target.checked })} />Remind HR before it expires</label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={discard} className={btn.secondary}>Discard</button>
              <button onClick={confirm} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Filing…" : "File document"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </Card>
  );
}

// window.confirm wrapper (named to avoid clashing with the confirm() action).
function confirm2(msg: string) {
  return typeof window === "undefined" ? true : window.confirm(msg);
}
