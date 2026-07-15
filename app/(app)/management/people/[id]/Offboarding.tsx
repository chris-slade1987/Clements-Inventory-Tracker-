"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Opt = { key: string; label: string };
type ExitItem = { key: string; type: "choice" | "textarea" | "yesno"; label: string; options?: string[] };
type ExitSection = { title: string; items: ExitItem[] };
type Sep = {
  separationType: string;
  reasonCategory: string | null;
  reasonNotes: string | null;
  lastDay: string | null;
  rehireEligible: boolean | null;
  docs: { file: string; name: string }[];
  exitStatus: string;
  exitBypassReason: string | null;
  exitResponses: Record<string, string>;
  exitInterviewAt: string | null;
  exitInterviewBy: string | null;
  createdByName: string | null;
} | null;

export default function Offboarding({
  employeeId, employeeName, status, separation, canManage, types, reasons, exitForm,
}: {
  employeeId: string; employeeName: string; status: string; separation: Sep;
  canManage: boolean; types: Opt[]; reasons: Opt[]; exitForm: ExitSection[];
}) {
  const router = useRouter();
  if (!canManage) return null;
  const active = status === "active";

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-sm font-medium text-ink">Employment status</div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>{active ? "Active" : "Former employee"}</span>
      </div>
      {active ? (
        <TerminatePanel employeeId={employeeId} employeeName={employeeName} types={types} reasons={reasons} onDone={() => router.refresh()} />
      ) : (
        <FormerPanel employeeId={employeeId} separation={separation} exitForm={exitForm} types={types} reasons={reasons} onDone={() => router.refresh()} />
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
function TerminatePanel({ employeeId, employeeName, types, reasons, onDone }: { employeeId: string; employeeName: string; types: Opt[]; reasons: Opt[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ separationType: "", reasonCategory: "", reasonNotes: "", lastDay: new Date().toISOString().slice(0, 10), rehireEligible: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [bypassExit, setBypassExit] = useState(false);
  const [bypassReason, setBypassReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!f.separationType) return setError("Choose the separation type.");
    if (bypassExit && !bypassReason.trim()) return setError("Give a brief reason for bypassing the exit interview.");
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("action", "terminate");
    fd.set("employeeId", employeeId);
    fd.set("separationType", f.separationType);
    fd.set("reasonCategory", f.reasonCategory);
    fd.set("reasonNotes", f.reasonNotes);
    fd.set("lastDay", f.lastDay);
    if (f.rehireEligible) fd.set("rehireEligible", f.rehireEligible);
    fd.set("bypassExit", String(bypassExit));
    if (bypassExit) fd.set("bypassReason", bypassReason);
    for (const file of files) fd.append("docs", file);
    const res = await fetch("/api/personnel/lifecycle", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not offboard.");
    setOpen(false); onDone();
  }

  if (!open) {
    return (
      <div>
        <p className="text-xs text-muted mb-3">Offboarding moves this profile to Former employees and disables their login. All records are retained.</p>
        <button onClick={() => setOpen(true)} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">Terminate / offboard</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Offboarding <span className="font-medium text-ink">{employeeName}</span>. This moves the profile to Former employees and disables their login.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Separation type
          <select value={f.separationType} onChange={(e) => setF({ ...f, separationType: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            <option value="">— Select —</option>
            {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Reason
          <select value={f.reasonCategory} onChange={(e) => setF({ ...f, reasonCategory: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            <option value="">— Select —</option>
            {reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Last day worked
          <input type="date" value={f.lastDay} onChange={(e) => setF({ ...f, lastDay: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
        </label>
        <label className="block text-sm font-medium">Eligible for rehire
          <select value={f.rehireEligible} onChange={(e) => setF({ ...f, rehireEligible: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            <option value="">— Not assessed —</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">Details / reason notes
        <textarea value={f.reasonNotes} onChange={(e) => setF({ ...f, reasonNotes: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="Context for the file (optional but recommended for involuntary separations)." />
      </label>
      <label className="block text-sm font-medium">Supporting documents
        <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white" />
        {files.length > 0 ? <span className="mt-1 block text-[11px] text-muted">{files.length} file{files.length === 1 ? "" : "s"} attached</span> : null}
      </label>

      <div className="rounded-lg bg-black/[0.02] p-3">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={bypassExit} onChange={(e) => setBypassExit(e.target.checked)} className="mt-0.5" />
          <span>Bypass the exit interview <span className="text-muted">(for separations not on good terms, e.g. misconduct or job abandonment)</span></span>
        </label>
        {bypassExit ? (
          <input value={bypassReason} onChange={(e) => setBypassReason(e.target.value)} placeholder="Reason for bypassing (required)" className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        ) : (
          <p className="mt-1 text-[11px] text-muted">Otherwise the exit interview stays open for HR to conduct from this profile.</p>
        )}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={() => { setOpen(false); setError(null); }} className={btn.secondary}>Cancel</button>
        <button onClick={submit} disabled={busy} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{busy ? "Saving…" : "Confirm offboarding"}</button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
function FormerPanel({ employeeId, separation, exitForm, types, reasons, onDone }: { employeeId: string; separation: Sep; exitForm: ExitSection[]; types: Opt[]; reasons: Opt[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conducting, setConducting] = useState(false);
  const [bypassing, setBypassing] = useState(false);
  const [bypassReason, setBypassReason] = useState("");
  const [resp, setResp] = useState<Record<string, string>>(separation?.exitResponses ?? {});

  async function reactivate() {
    if (!confirm("Reactivate this employee? Their login is re-enabled and the separation record is removed.")) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/personnel/lifecycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reactivate", employeeId }) });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Failed."); }
    onDone();
  }
  async function saveExit(mode: "complete" | "bypass") {
    if (mode === "bypass" && !bypassReason.trim()) return setError("Give a brief reason for bypassing.");
    setBusy(true); setError(null);
    const res = await fetch("/api/personnel/lifecycle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "bypass" ? { action: "exit", employeeId, mode: "bypass", bypassReason } : { action: "exit", employeeId, mode: "complete", responses: resp }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Failed."); }
    setConducting(false); setBypassing(false); onDone();
  }

  const exit = separation?.exitStatus ?? "pending";

  return (
    <div className="space-y-4">
      {/* Separation summary */}
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-sm">
        <Row label="Separation type" value={separation ? label(separation.separationType, types) : "—"} />
        <Row label="Last day" value={separation?.lastDay ? new Date(separation.lastDay).toLocaleDateString() : "—"} />
        <Row label="Reason" value={label(separation?.reasonCategory ?? null, reasons)} />
        <Row label="Rehire eligible" value={separation?.rehireEligible == null ? "Not assessed" : separation.rehireEligible ? "Yes" : "No"} />
        {separation?.createdByName ? <Row label="Recorded by" value={separation.createdByName} /> : null}
      </div>
      {separation?.reasonNotes ? <p className="text-sm text-muted whitespace-pre-line rounded-lg bg-black/[0.02] p-2">{separation.reasonNotes}</p> : null}
      {separation?.docs?.length ? (
        <div className="text-sm">
          <div className="text-xs font-medium text-muted mb-1">Supporting documents</div>
          <ul className="space-y-1">
            {separation.docs.map((d, i) => <li key={i}><a href={d.file} target="_blank" className="text-brand-700 hover:underline">📎 {d.name}</a></li>)}
          </ul>
        </div>
      ) : null}

      {/* Exit interview */}
      <div className="rounded-lg border border-line p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-sm font-medium text-ink">Exit interview</div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${exit === "completed" ? "bg-emerald-100 text-emerald-700" : exit === "bypassed" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"}`}>
            {exit === "completed" ? "Completed" : exit === "bypassed" ? "Bypassed" : "Pending"}
          </span>
        </div>

        {exit === "bypassed" ? (
          <p className="text-sm text-muted">Bypassed{separation?.exitBypassReason ? `: ${separation.exitBypassReason}` : "."}</p>
        ) : exit === "completed" ? (
          <div className="space-y-3">
            <p className="text-[11px] text-muted">Conducted by {separation?.exitInterviewBy ?? "HR"}{separation?.exitInterviewAt ? ` · ${new Date(separation.exitInterviewAt).toLocaleDateString()}` : ""}.</p>
            {exitForm.map((sec) => {
              const rows = sec.items.filter((it) => (resp[it.key] ?? "").trim());
              if (!rows.length) return null;
              return (
                <div key={sec.title}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted">{sec.title}</div>
                  <dl className="mt-1 space-y-1">
                    {rows.map((it) => <div key={it.key} className="text-sm"><dt className="text-muted">{it.label}</dt><dd className="text-ink whitespace-pre-line">{resp[it.key]}</dd></div>)}
                  </dl>
                </div>
              );
            })}
          </div>
        ) : conducting ? (
          <div className="space-y-3">
            {exitForm.map((sec) => (
              <div key={sec.title} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">{sec.title}</div>
                {sec.items.map((it) => <ExitRow key={it.key} it={it} value={resp[it.key] ?? ""} onChange={(v) => setResp((s) => ({ ...s, [it.key]: v }))} />)}
              </div>
            ))}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2">
              <button onClick={() => setConducting(false)} className={btn.secondary}>Cancel</button>
              <button onClick={() => saveExit("complete")} disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Save exit interview"}</button>
            </div>
          </div>
        ) : bypassing ? (
          <div className="space-y-2">
            <input value={bypassReason} onChange={(e) => setBypassReason(e.target.value)} placeholder="Reason for bypassing (required)" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2">
              <button onClick={() => setBypassing(false)} className={btn.secondary}>Cancel</button>
              <button onClick={() => saveExit("bypass")} disabled={busy} className="rounded-lg bg-slate-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">{busy ? "Saving…" : "Confirm bypass"}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setConducting(true); setError(null); }} className={btn.primary}>Conduct exit interview</button>
            <button onClick={() => { setBypassing(true); setError(null); }} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-muted hover:text-ink">Bypass</button>
          </div>
        )}
      </div>

      {error && !conducting && !bypassing ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="pt-1">
        <button onClick={reactivate} disabled={busy} className="text-xs font-medium text-brand-700 hover:underline">Reactivate / rehire this employee</button>
      </div>
    </div>
  );
}

const TYPE_FALLBACK: Opt[] = [];
function label(key: string | null, opts: Opt[]) { return opts.find((o) => o.key === key)?.label ?? key ?? "—"; }

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-line/60 py-1"><dt className="text-muted">{label}</dt><dd className="text-ink text-right">{value}</dd></div>;
}

function ExitRow({ it, value, onChange }: { it: ExitItem; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-sm text-ink mb-1">{it.label}</div>
      {(it.type === "yesno" || it.type === "choice") ? (
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
          {(it.type === "yesno" ? ["Yes", "No"] : it.options ?? []).map((opt) => (
            <button key={opt} type="button" onClick={() => onChange(opt)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${value === opt ? "bg-emerald-grad text-[#05271c] shadow" : "text-slate-600 hover:text-slate-900"}`}>{opt}</button>
          ))}
        </div>
      ) : (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
      )}
    </div>
  );
}
