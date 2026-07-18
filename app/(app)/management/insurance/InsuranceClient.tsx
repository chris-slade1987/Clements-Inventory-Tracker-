"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";

type Line = { key: string; label: string };
type Freq = { key: string; label: string };
export type PolicyDoc = { id: string; title: string; filePath: string | null; category: string };
export type Policy = {
  id: string;
  line: string;
  name: string;
  carrier: string | null;
  policyNumber: string | null;
  agent: string | null;
  status: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  annualPremium: number | null;
  notes: string | null;
  paymentMethod: string;
  paymentFrequency: string;
  downPayment: number | null;
  numberOfPayments: number | null;
  paymentAmount: number | null;
  apr: number | null;
  financeCompany: string | null;
  financeAccount: string | null;
  needsReview: boolean;
  documents: PolicyDoc[];
  installmentCount: number;
};

const STATUSES = ["active", "pending", "application", "expired", "cancelled"];
const money = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));

type FormState = {
  id?: string;
  documentId?: string | null;
  line: string; name: string; carrier: string; policyNumber: string; agent: string; status: string;
  effectiveDate: string; expirationDate: string; annualPremium: string; notes: string;
  paymentFrequency: string; downPayment: string; numberOfPayments: string; paymentAmount: string; apr: string; financeCompany: string; financeAccount: string;
  needsReview: boolean; aiSummary?: string; source?: string;
};

const blank = (): FormState => ({
  line: "general_liability", name: "", carrier: "", policyNumber: "", agent: "", status: "active",
  effectiveDate: "", expirationDate: "", annualPremium: "", notes: "",
  paymentFrequency: "annual", downPayment: "", numberOfPayments: "", paymentAmount: "", apr: "", financeCompany: "", financeAccount: "",
  needsReview: false,
});

export default function InsuranceClient({ lines, freqs, policiesByLine }: { lines: Line[]; freqs: Freq[]; policiesByLine: { key: string; label: string; policies: Policy[] }[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readNote, setReadNote] = useState<string | null>(null);

  const set = (k: keyof FormState, v: string | boolean) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReading(true); setError(null); setReadNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/insurance/document", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Upload failed."); return; }
      const a = data.analysis;
      setForm({
        documentId: data.documentId, line: a.line ?? "other", name: a.name ?? "", carrier: a.carrier ?? "", policyNumber: a.policyNumber ?? "",
        agent: a.agent ?? "", status: "active", effectiveDate: a.effectiveDate ?? "", expirationDate: a.expirationDate ?? "",
        annualPremium: a.annualPremium != null ? String(a.annualPremium) : "", notes: "",
        paymentFrequency: a.paymentFrequency ?? "annual", downPayment: a.downPayment != null ? String(a.downPayment) : "",
        numberOfPayments: a.numberOfPayments != null ? String(a.numberOfPayments) : "", paymentAmount: a.paymentAmount != null ? String(a.paymentAmount) : "",
        apr: a.apr != null ? String(a.apr) : "", financeCompany: a.financeCompany ?? "", financeAccount: "",
        needsReview: a.source === "mock", aiSummary: a.summary, source: a.source,
      });
      setReadNote(data.mode === "mock" ? "Automatic reading isn't configured here — please fill in the details." : `Read by AI — please confirm. ${a.summary ?? ""}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReading(false);
    }
  }

  function editPolicy(p: Policy) {
    setReadNote(null); setError(null);
    setForm({
      id: p.id, line: p.line, name: p.name, carrier: p.carrier ?? "", policyNumber: p.policyNumber ?? "", agent: p.agent ?? "", status: p.status,
      effectiveDate: p.effectiveDate ?? "", expirationDate: p.expirationDate ?? "", annualPremium: p.annualPremium != null ? String(p.annualPremium) : "", notes: p.notes ?? "",
      paymentFrequency: p.paymentFrequency, downPayment: p.downPayment != null ? String(p.downPayment) : "", numberOfPayments: p.numberOfPayments != null ? String(p.numberOfPayments) : "",
      paymentAmount: p.paymentAmount != null ? String(p.paymentAmount) : "", apr: p.apr != null ? String(p.apr) : "", financeCompany: p.financeCompany ?? "", financeAccount: p.financeAccount ?? "",
      needsReview: p.needsReview,
    });
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return setError("Give the policy a name.");
    setBusy(true); setError(null);
    const res = await fetch("/api/insurance/policy", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: form.id ? "update" : "create", ...form, paymentMethod: form.paymentFrequency === "financed" ? "financed" : "direct" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save.");
    setForm(null);
    router.refresh();
  }

  async function del(id: string) {
    if (!confirm("Remove this policy and its schedule?")) return;
    await fetch("/api/insurance/policy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    router.refresh();
  }

  const isFinanced = form?.paymentFrequency === "financed";

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-5">
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={onFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={reading} className={btn.primary}>
          {reading ? "Reading document…" : "Upload policy document"}
        </button>
        <button onClick={() => { setForm(blank()); setReadNote(null); setError(null); }} className={btn.secondary}>Add policy manually</button>
      </div>

      {/* Policies grouped by line */}
      {policiesByLine.length === 0 ? (
        <Card className="p-8 text-center text-muted">No policies yet. Upload a policy document or add one manually.</Card>
      ) : (
        <div className="space-y-5">
          {policiesByLine.map((g) => (
            <Card key={g.key} className="p-0 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line bg-black/[0.02] flex items-center justify-between">
                <div className="text-sm font-semibold text-ink">{g.label}</div>
                <div className="text-xs text-muted tabular-nums">{money(g.policies.reduce((s, p) => s + (p.annualPremium ?? 0), 0))}/yr</div>
              </div>
              <ul className="divide-y divide-line">
                {g.policies.map((p) => (
                  <li key={p.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-ink">{p.name}</span>
                          <StatusBadge status={p.status} />
                          {p.needsReview ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Needs review</span> : null}
                        </div>
                        <div className="text-xs text-muted mt-0.5">
                          {[p.carrier, p.policyNumber ? `#${p.policyNumber}` : null, p.agent].filter(Boolean).join(" · ") || "—"}
                        </div>
                        <div className="text-xs text-muted mt-0.5">
                          {p.effectiveDate ? `${fmt(p.effectiveDate)} – ${fmt(p.expirationDate)}` : "No term set"}
                          {p.paymentFrequency === "financed" ? ` · financed${p.numberOfPayments ? ` (${p.numberOfPayments}× ${money(p.paymentAmount)})` : ""}` : p.paymentFrequency !== "annual" ? ` · ${p.paymentFrequency}` : ""}
                          {p.installmentCount > 0 ? ` · ${p.installmentCount} scheduled payment${p.installmentCount === 1 ? "" : "s"}` : ""}
                        </div>
                        {p.documents.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {p.documents.map((d) => (
                              d.filePath ? <a key={d.id} href={d.filePath} target="_blank" className="text-[11px] text-brand-700 hover:underline">📄 {d.title}</a> : <span key={d.id} className="text-[11px] text-muted">📄 {d.title}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-ink tabular-nums">{money(p.annualPremium)}<span className="text-[11px] font-normal text-muted">/yr</span></div>
                        <div className="mt-1 flex gap-2 justify-end">
                          <button onClick={() => editPolicy(p)} className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
                          <button onClick={() => del(p.id)} className="text-xs text-muted hover:text-red-600">Delete</button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {/* Confirm / edit modal */}
      {form ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold">{form.id ? "Edit policy" : "Confirm policy"}</h3>
              <button onClick={() => setForm(null)} className="text-muted hover:text-ink text-xl leading-none">×</button>
            </div>
            {readNote ? <div className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2 text-xs text-brand-800">{readNote}</div> : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Line of business">
                <select value={form.line} onChange={(e) => set("line", e.target.value)} className={inp}>
                  {lines.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(e) => set("status", e.target.value)} className={inp}>
                  {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Policy name / descriptor">
              <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Fleet Auto — Auto-Owners" className={inp} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Carrier"><input value={form.carrier} onChange={(e) => set("carrier", e.target.value)} className={inp} /></Field>
              <Field label="Policy number"><input value={form.policyNumber} onChange={(e) => set("policyNumber", e.target.value)} className={inp} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Agent / broker"><input value={form.agent} onChange={(e) => set("agent", e.target.value)} className={inp} /></Field>
              <Field label="Annual premium ($)"><input value={form.annualPremium} onChange={(e) => set("annualPremium", e.target.value)} className={inp} inputMode="decimal" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Effective date"><DateInput value={form.effectiveDate} onChange={(v) => set("effectiveDate", v)} /></Field>
              <Field label="Expiration / renewal date"><DateInput value={form.expirationDate} onChange={(v) => set("expirationDate", v)} /></Field>
            </div>
            <Field label="Payment schedule">
              <select value={form.paymentFrequency} onChange={(e) => set("paymentFrequency", e.target.value)} className={inp}>
                {freqs.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </Field>
            {isFinanced ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Down payment"><input value={form.downPayment} onChange={(e) => set("downPayment", e.target.value)} className={inp} inputMode="decimal" /></Field>
                <Field label="# Payments"><input value={form.numberOfPayments} onChange={(e) => set("numberOfPayments", e.target.value)} className={inp} inputMode="numeric" /></Field>
                <Field label="Payment amt"><input value={form.paymentAmount} onChange={(e) => set("paymentAmount", e.target.value)} className={inp} inputMode="decimal" /></Field>
                <Field label="APR %"><input value={form.apr} onChange={(e) => set("apr", e.target.value)} className={inp} inputMode="decimal" /></Field>
                <Field label="Finance company"><input value={form.financeCompany} onChange={(e) => set("financeCompany", e.target.value)} className={inp} /></Field>
                <Field label="Finance account"><input value={form.financeAccount} onChange={(e) => set("financeAccount", e.target.value)} className={inp} /></Field>
              </div>
            ) : null}
            <Field label="Notes">
              <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={inp} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={form.needsReview} onChange={(e) => set("needsReview", e.target.checked)} className="accent-brand-600" /> Flag for review (missing details)
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setForm(null)} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : form.id ? "Save changes" : "Save policy"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

const inp = "mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface";
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-ink">{label}{children}</label>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-brand-100 text-brand-700", pending: "bg-blue-100 text-blue-700", application: "bg-amber-100 text-amber-700",
    expired: "bg-slate-100 text-slate-500", cancelled: "bg-red-100 text-red-700",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${map[status] ?? map.active}`}>{status}</span>;
}
