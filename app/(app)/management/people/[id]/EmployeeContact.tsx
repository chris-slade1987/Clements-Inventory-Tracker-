"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";

export default function EmployeeContact({
  id,
  canEdit,
  initial,
  emailConfigured,
}: {
  id: string;
  canEdit: boolean;
  initial: { email: string; phone: string; title: string; status: string; hireDate: string };
  emailConfigured: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/management/employee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...f }),
    });
    setBusy(false);
    if (res.ok) { setMsg("Saved."); router.refresh(); }
    else setMsg("Save failed.");
  }

  return (
    <Card className="p-4">
      <div className="text-sm font-medium text-ink mb-2">Contact</div>
      <div className="space-y-2">
        <Row label="Work email" v={f.email} on={(v) => setF({ ...f, email: v })} disabled={!canEdit} placeholder="name@clementspestcontrol.com" type="email" />
        <Row label="Phone" v={f.phone} on={(v) => setF({ ...f, phone: v })} disabled={!canEdit} />
        <Row label="Title" v={f.title} on={(v) => setF({ ...f, title: v })} disabled={!canEdit} />
        <Row label="Hire date" v={f.hireDate} on={(v) => setF({ ...f, hireDate: v })} disabled={!canEdit} type="date" />
      </div>
      {canEdit ? <p className="mt-2 text-[11px] text-muted">Hire date schedules the 30 & 60-day new-hire reviews automatically.</p> : null}
      {!f.email ? (
        <p className="mt-2 text-[11px] text-amber-600">No email on file — inspection-score emails are logged but not delivered until an address is added.</p>
      ) : !emailConfigured ? (
        <p className="mt-2 text-[11px] text-amber-600">Email provider not configured (set RESEND_API_KEY) — sends are logged only.</p>
      ) : null}
      {canEdit ? (
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Save"}</button>
          {msg ? <span className="text-xs text-muted">{msg}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

function Row({ label, v, on, disabled, placeholder, type }: { label: string; v: string; on: (v: string) => void; disabled: boolean; placeholder?: string; type?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      {type === "date" ? (
        <DateInput className="w-56" value={v} onChange={on} disabled={disabled} />
      ) : (
        <input type={type ?? "text"} value={v} onChange={(e) => on(e.target.value)} disabled={disabled} placeholder={placeholder} className="w-56 rounded-lg border border-line px-2 py-1.5 text-sm text-ink disabled:opacity-70" />
      )}
    </label>
  );
}
