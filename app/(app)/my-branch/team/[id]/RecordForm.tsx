"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { RECORD_TYPES, WRITEUP_CATEGORIES, ACCIDENT_SEVERITY, ACCIDENT_FIELDS, ACCIDENT_CHECKLIST } from "@/lib/personnel";

const today = () => new Date().toISOString().slice(0, 10);

export default function RecordForm({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const router = useRouter();
  const [type, setType] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [incidentDate, setIncidentDate] = useState(today());
  const [actionTaken, setActionTaken] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function pick(t: string) {
    setType(t);
    setCategory(t === "writeup" ? "verbal" : t === "accident" ? "minor" : "");
    setTitle(""); setBody(""); setActionTaken(""); setFollowUp(""); setDetails({}); setChecklist({}); setFile(null);
    setError(null); setMsg(null);
  }

  async function submit() {
    if (!type) return;
    if (type === "accident" ? false : !body.trim() && !title.trim()) return setError("Add a title or description.");
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("employeeId", employeeId);
    fd.set("type", type);
    if (category) fd.set("category", category);
    fd.set("title", title);
    fd.set("body", body);
    fd.set("actionTaken", actionTaken);
    fd.set("followUp", followUp);
    if (type === "writeup" || type === "accident") fd.set("incidentDate", incidentDate);
    if (type === "accident") fd.set("details", JSON.stringify({ ...details, checklist }));
    if (file) fd.set("file", file);
    const res = await fetch("/api/personnel/record", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setMsg(`Filed. HR ${data.emailStatus === "sent" ? "emailed" : "notification queued"} (${data.hrEmail}).`);
    setType(null);
    router.refresh();
  }

  if (!type) {
    return (
      <Card className="p-4">
        <div className="text-sm font-medium text-ink mb-1">File a record for {employeeName.split(" ")[0]}</div>
        <p className="text-xs text-muted mb-3">Every submission is emailed to HR (April Williford) and filed to this profile.</p>
        <div className="flex flex-wrap gap-2">
          {RECORD_TYPES.map((t) => (
            <button key={t.key} onClick={() => pick(t.key)} className={`${btn.secondary} flex items-center gap-2`}>
              <span>{t.icon}</span>{t.label}
            </button>
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

      {isWriteup ? (
        <label className="block text-sm font-medium">Level
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            {WRITEUP_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
      ) : null}

      {isAccident ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Severity
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              {ACCIDENT_SEVERITY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Date / time of incident
            <input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
          </label>
        </div>
      ) : null}

      {isWriteup ? (
        <label className="block text-sm font-medium">Incident date
          <input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
        </label>
      ) : null}

      <label className="block text-sm font-medium">{isAccident ? "Summary" : "Title"}
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>

      <label className="block text-sm font-medium">{isAccident ? "What happened" : isWriteup ? "Description of issue" : "Details"}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>

      {isAccident ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {ACCIDENT_FIELDS.map((f) => (
              <label key={f.key} className="block text-sm font-medium">{f.label}
                <input value={details[f.key] ?? ""} onChange={(e) => setDetails((s) => ({ ...s, [f.key]: e.target.value }))} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
            ))}
          </div>
          <div className="rounded-lg border border-line p-3">
            <div className="text-sm font-medium text-ink mb-2">Manager response checklist</div>
            <ul className="space-y-1.5">
              {ACCIDENT_CHECKLIST.map((c) => (
                <li key={c.key}>
                  <button onClick={() => setChecklist((s) => ({ ...s, [c.key]: !s[c.key] }))} className="flex items-start gap-2 text-left w-full group">
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs ${checklist[c.key] ? "bg-emerald-grad border-transparent text-[#05271c]" : "border-line text-transparent group-hover:border-brand-400"}`}>✓</span>
                    <span className={`text-sm ${checklist[c.key] ? "text-muted line-through" : "text-ink"}`}>{c.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      {(isWriteup || isAccident) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">{isAccident ? "Corrective action" : "Action taken"}
            <textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium">Follow-up / next steps
            <textarea value={followUp} onChange={(e) => setFollowUp(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
        </div>
      ) : null}

      <label className="block text-sm font-medium">Attachment (optional)
        <input type="file" accept="application/pdf,image/*,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-brand-700" />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={() => setType(null)} className={btn.secondary}>Cancel</button>
        <button onClick={submit} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Filing…" : `File ${typeLabel.toLowerCase()} & notify HR`}</button>
      </div>
    </Card>
  );
}
