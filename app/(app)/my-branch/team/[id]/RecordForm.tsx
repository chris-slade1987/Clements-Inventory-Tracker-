"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import {
  RECORD_TYPES, WRITEUP_CATEGORIES, WRITEUP_FIELDS,
  ACCIDENT_SEVERITY, ACCIDENT_FIELDS, ACCIDENT_CHECKLIST_GROUPS, ACCIDENT_NOTES,
  ACCIDENT_COMPLIANCE, WRITEUP_LEGAL, ACCIDENT_LEGAL,
} from "@/lib/personnel";

const today = () => new Date().toISOString().slice(0, 10);

export default function RecordForm({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const router = useRouter();
  const [type, setType] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [incidentDate, setIncidentDate] = useState(today());
  const [deadline, setDeadline] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function pick(t: string) {
    setType(t);
    setCategory(t === "writeup" ? "verbal" : t === "accident" ? "minor" : "");
    setTitle(""); setBody(""); setActionTaken(""); setDeadline(""); setDetails({}); setChecklist({}); setFile(null);
    setError(null); setMsg(null);
  }
  const setD = (k: string, v: string) => setDetails((s) => ({ ...s, [k]: v }));

  async function submit() {
    if (!type) return;
    if (type !== "accident" && !body.trim() && !title.trim()) return setError("Add a title or description.");
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("employeeId", employeeId);
    fd.set("type", type);
    if (category) fd.set("category", category);
    fd.set("title", title);
    fd.set("body", body);
    fd.set("actionTaken", actionTaken);
    if (type === "writeup" || type === "accident") fd.set("incidentDate", incidentDate);
    if (type === "writeup") fd.set("details", JSON.stringify({ ...details, ...(deadline ? { deadline } : {}) }));
    if (type === "accident") fd.set("details", JSON.stringify({ ...details, checklist }));
    if (file) fd.set("file", file);
    const res = await fetch("/api/personnel/record", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    const n = Array.isArray(data.notified) ? data.notified.length : 0;
    setMsg(`Filed. ${data.emailStatus === "sent" ? `Emailed to ${n} recipient${n === 1 ? "" : "s"}` : `Notification queued for ${n} recipient${n === 1 ? "" : "s"}`}.`);
    setType(null);
    router.refresh();
  }

  if (!type) {
    return (
      <Card className="p-4">
        <div className="text-sm font-medium text-ink mb-1">File a record for {employeeName.split(" ")[0]}</div>
        <p className="text-xs text-muted mb-3">Filed to this profile and emailed to HR (April Williford). Write-ups &amp; accident reports also notify Graham Foster, Chris Slade, and Tim Slade.</p>
        <div className="flex flex-wrap gap-2">
          {RECORD_TYPES.map((t) => (
            <button key={t.key} onClick={() => pick(t.key)} className={`${btn.secondary} flex items-center gap-2`}><span>{t.icon}</span>{t.label}</button>
          ))}
        </div>
        {msg ? <p className="mt-3 text-sm text-brand-700">{msg}</p> : null}
      </Card>
    );
  }

  const isAccident = type === "accident";
  const isWriteup = type === "writeup";
  const typeLabel = RECORD_TYPES.find((t) => t.key === type)?.label ?? type;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-ink">New {typeLabel.toLowerCase()} — {employeeName}</div>
        <button onClick={() => setType(null)} className="text-xs text-muted hover:text-red-600">Cancel</button>
      </div>

      {(isWriteup || isAccident) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">{isWriteup ? "Type of disciplinary action" : "Severity"}
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              {(isWriteup ? WRITEUP_CATEGORIES : ACCIDENT_SEVERITY).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">{isAccident ? "Date of accident" : "Date of incident"}
            <input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
          </label>
        </div>
      ) : null}

      <label className="block text-sm font-medium">{isAccident ? "Summary" : "Title"}
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>

      <label className="block text-sm font-medium">{isAccident ? "Description of accident" : isWriteup ? "Description of incident" : "Details"}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder={isAccident ? "What happened, how it happened, contributing factors" : isWriteup ? "Date, time, location, and specific details" : ""} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>

      {/* Write-up specifics (Disciplinary Action Form) */}
      {isWriteup ? (
        <>
          {WRITEUP_FIELDS.map((f) => (
            <label key={f.key} className="block text-sm font-medium">{f.label}
              {f.area
                ? <textarea value={details[f.key] ?? ""} onChange={(e) => setD(f.key, e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
                : <input value={details[f.key] ?? ""} onChange={(e) => setD(f.key, e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />}
            </label>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Corrective action required
              <textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">Deadline for improvement
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
            </label>
          </div>
          <p className="text-[11px] text-muted">Employee &amp; supervisor signature and HR sign-off are captured on the filed record; digital sign-off is coming.</p>
        </>
      ) : null}

      {/* Accident specifics (Workplace Accident Report + supervisor checklist) */}
      {isAccident ? (
        <>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
            {ACCIDENT_NOTES.map((n, i) => <div key={i}>• {n}</div>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {ACCIDENT_FIELDS.map((f) => (
              <label key={f.key} className="block text-sm font-medium">{f.label}
                <input value={details[f.key] ?? ""} onChange={(e) => setD(f.key, e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
            ))}
          </div>
          <div className="rounded-lg border border-line p-3">
            <div className="text-sm font-medium text-ink mb-2">Compliance</div>
            <div className="space-y-1.5">
              {ACCIDENT_COMPLIANCE.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <div className="flex-1 text-sm text-ink">{c.label}</div>
                  <div className="flex gap-1 rounded-xl bg-black/20 p-1">
                    <button onClick={() => setD(c.key, "Yes")} className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${details[c.key] === "Yes" ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>Yes</button>
                    <button onClick={() => setD(c.key, "No")} className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${details[c.key] === "No" ? "bg-red-500 text-white shadow" : "text-mint hover:text-white"}`}>No</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <label className="block text-sm font-medium">Supervisor&rsquo;s comments
            <textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
          <div className="rounded-lg border border-line p-3">
            <div className="text-sm font-medium text-ink mb-2">Supervisor&rsquo;s injury-response checklist</div>
            {ACCIDENT_CHECKLIST_GROUPS.map((g) => (
              <div key={g.group} className="mb-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">{g.group}</div>
                <ul className="space-y-1">
                  {g.items.map((c) => (
                    <li key={c.key}>
                      <button onClick={() => setChecklist((s) => ({ ...s, [c.key]: !s[c.key] }))} className="flex items-start gap-2 text-left w-full group">
                        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs ${checklist[c.key] ? "bg-emerald-grad border-transparent text-[#05271c]" : "border-line text-transparent group-hover:border-brand-400"}`}>✓</span>
                        <span className={`text-sm ${checklist[c.key] ? "text-muted line-through" : "text-ink"}`}>{c.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <label className="block text-sm font-medium">Attachment (optional)
        <input type="file" accept="application/pdf,image/*,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-brand-700" />
      </label>

      {isWriteup || isAccident ? (
        <p className="text-[11px] leading-relaxed text-muted border-t border-line pt-2">{isWriteup ? WRITEUP_LEGAL : ACCIDENT_LEGAL}</p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={() => setType(null)} className={btn.secondary}>Cancel</button>
        <button onClick={submit} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Filing…" : `File ${typeLabel.toLowerCase()} & notify HR`}</button>
      </div>
      {isWriteup || isAccident ? <p className="text-[11px] text-muted">A signature panel opens on the filed record for employee/supervisor{isWriteup ? "/HR" : ""} e-signatures.</p> : null}
    </Card>
  );
}
