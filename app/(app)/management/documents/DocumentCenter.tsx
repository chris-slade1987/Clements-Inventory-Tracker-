"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";

type VehicleOpt = { id: string; label: string };
type Analysis = {
  category: string; title: string; insurer: string | null; policyNumber: string | null;
  effectiveDate: string | null; expirationDate: string | null; vehicleHint: string | null;
  driverHint: string | null; summary: string; source: "claude" | "mock";
};
type Draft = {
  id: string; filePath: string | null; mode: string; analysis: Analysis;
  suggestion: { vehicleId: string | null; confidence: string | null; vehicleLabel: string | null };
};

const CATEGORIES = [
  { key: "insurance", label: "Insurance" },
  { key: "registration", label: "Registration" },
  { key: "title", label: "Title" },
  { key: "inspection", label: "Inspection / emissions" },
  { key: "other", label: "Other" },
];

export default function DocumentCenter({ vehicles, defaultVehicleId }: { vehicles: VehicleOpt[]; defaultVehicleId?: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState({ vehicleId: "", category: "other", title: "", insurer: "", policyNumber: "", effectiveDate: "", expirationDate: "", remindHr: true, notes: "" });

  async function onFile(file: File) {
    setBusy(true); setError(null); setDraft(null);
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/fleet/document", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return setError(data.error ?? "Upload failed.");
    const d = data as Draft;
    setDraft(d);
    setForm({
      vehicleId: d.suggestion.vehicleId ?? defaultVehicleId ?? "",
      category: d.analysis.category ?? "other",
      title: d.analysis.title ?? "",
      insurer: d.analysis.insurer ?? "",
      policyNumber: d.analysis.policyNumber ?? "",
      effectiveDate: d.analysis.effectiveDate ?? "",
      expirationDate: d.analysis.expirationDate ?? "",
      remindHr: true,
      notes: "",
    });
  }

  async function confirm() {
    if (!draft) return;
    if (!form.vehicleId) return setError("Choose which vehicle this document belongs to.");
    setBusy(true); setError(null);
    const res = await fetch("/api/fleet/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", id: draft.id, ...form }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not file the document.");
    setDraft(null);
    router.refresh();
  }

  async function discard() {
    if (draft) await fetch("/api/fleet/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: draft.id }) });
    setDraft(null); setError(null); router.refresh();
  }

  return (
    <Card className="p-4 mb-5">
      <div className="text-sm font-medium text-ink">Upload a document</div>
      <p className="mt-0.5 text-xs text-muted">Insurance policies, registrations, titles. The reader figures out which vehicle it belongs to, then you confirm before it&rsquo;s filed.</p>

      {!draft ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={() => fileRef.current?.click()} disabled={busy} className={btn.primary}>{busy ? "Reading…" : "Choose file"}</button>
          <input ref={fileRef} type="file" accept=".pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <span className="text-xs text-muted">PDF or image · the AI reads it and suggests where to file it</span>
        </div>
      ) : null}
      {error && !draft ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

      {draft ? (
        <div className="mt-4 rounded-xl border border-line p-4 bg-black/[0.015]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-ink">Confirm filing</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${draft.mode === "claude" ? "bg-brand-100 text-brand-700" : "bg-amber-100 text-amber-700"}`}>{draft.mode === "claude" ? "AI read" : "Manual (no AI key)"}</span>
          </div>
          {draft.analysis.summary ? <p className="text-sm text-muted mb-3">{draft.analysis.summary}</p> : null}

          {draft.suggestion.vehicleLabel ? (
            <div className="mb-3 rounded-lg bg-brand-50 border border-brand-200 px-3 py-2 text-sm text-brand-800">
              Suggested vehicle: <span className="font-medium">{draft.suggestion.vehicleLabel}</span>
              {draft.suggestion.confidence ? <span className="ml-1 text-[11px] text-brand-600">({draft.suggestion.confidence} confidence)</span> : null}
              <span className="block text-[11px] text-brand-700/80">Matched from {draft.analysis.vehicleHint ? `“${draft.analysis.vehicleHint}”` : "the document"}. Change it below if that&rsquo;s not right.</span>
            </div>
          ) : (
            <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">Couldn&rsquo;t confidently match a vehicle — please pick one below.</div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Vehicle
              <select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                <option value="">— Select vehicle —</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
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
            <label className="block text-sm font-medium">Effective date
              <DateInput className="mt-1" value={form.effectiveDate} onChange={(v) => setForm({ ...form, effectiveDate: v })} />
            </label>
            <label className="block text-sm font-medium">Expiration / renewal date
              <DateInput className="mt-1" value={form.expirationDate} onChange={(v) => setForm({ ...form, expirationDate: v })} />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.remindHr} onChange={(e) => setForm({ ...form, remindHr: e.target.checked })} />
            Remind HR before this expires (renewal alert)
          </label>

          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <button onClick={discard} className={btn.secondary}>Discard</button>
            <button onClick={confirm} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Filing…" : "File to vehicle"}</button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
