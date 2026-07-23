"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Format a date-only "YYYY-MM-DD" value as e.g. "Jun 1, 1975" without any
// timezone conversion (the value is a plain calendar date). Empty -> "—".
function fmtStartDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return "—";
  const [, y, mo, d] = m;
  return `${MONTH_ABBR[Number(mo) - 1]} ${Number(d)}, ${y}`;
}

type Fields = { email: string; phone: string; personalPhone: string; title: string; status: string; hireDate: string };

export default function EmployeeContact({
  id,
  canEdit,
  initial,
  emailConfigured,
}: {
  id: string;
  canEdit: boolean;
  initial: Fields;
  emailConfigured: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [editing, setEditing] = useState(false);
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
    if (res.ok) { setMsg("Saved."); setEditing(false); router.refresh(); }
    else setMsg("Save failed.");
  }

  function cancel() {
    setF(initial);
    setEditing(false);
    setMsg(null);
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-ink">Contact</div>
        {canEdit && !editing ? (
          <button onClick={() => setEditing(true)} className="text-xs font-medium text-brand-300 hover:underline">Edit</button>
        ) : null}
      </div>

      {editing ? (
        <>
          <div className="space-y-2">
            <InputRow label="Work email" v={f.email} on={(v) => setF({ ...f, email: v })} placeholder="name@clementspestcontrol.com" type="email" />
            <InputRow label="Work phone" v={f.phone} on={(v) => setF({ ...f, phone: v })} type="tel" placeholder="(772) 555-0100" />
            <InputRow label="Personal phone" v={f.personalPhone} on={(v) => setF({ ...f, personalPhone: v })} type="tel" placeholder="(772) 555-0100" />
            <InputRow label="Title" v={f.title} on={(v) => setF({ ...f, title: v })} />
            <InputRow label="Start date" v={f.hireDate} on={(v) => setF({ ...f, hireDate: v })} type="date" />
          </div>
          <p className="mt-2 text-[11px] text-muted">Start date schedules the 30 &amp; 60-day new-hire reviews automatically.</p>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={save} disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Save"}</button>
            <button onClick={cancel} disabled={busy} className={btn.secondary}>Cancel</button>
            {msg ? <span className="text-xs text-muted">{msg}</span> : null}
          </div>
        </>
      ) : (
        <>
          <dl className="space-y-2">
            <ViewRow label="Work email" v={f.email} />
            <ViewRow label="Work phone" v={f.phone} />
            <ViewRow label="Personal phone" v={f.personalPhone} />
            <ViewRow label="Title" v={f.title} />
            <ViewRow label="Start date" v={fmtStartDate(f.hireDate)} raw />
          </dl>
          {!f.email ? (
            <p className="mt-2 text-[11px] text-amber-600">No email on file — inspection-score emails are logged but not delivered until an address is added.</p>
          ) : !emailConfigured ? (
            <p className="mt-2 text-[11px] text-amber-600">Email provider not configured (set RESEND_API_KEY) — sends are logged only.</p>
          ) : null}
          {msg ? <p className="mt-2 text-xs text-muted">{msg}</p> : null}
        </>
      )}
    </Card>
  );
}

// A read-only display row. `raw` means v is already presentation-ready (so an
// empty formatter result of "—" is shown verbatim rather than coerced again).
function ViewRow({ label, v, raw }: { label: string; v: string; raw?: boolean }) {
  const shown = raw ? v : (v.trim() || "—");
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{shown}</dd>
    </div>
  );
}

function InputRow({ label, v, on, placeholder, type }: { label: string; v: string; on: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      {type === "date" ? (
        <DateInput className="w-56" value={v} onChange={on} />
      ) : (
        <input type={type ?? "text"} value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder} className="w-56 rounded-lg border border-line px-2 py-1.5 text-sm text-ink" />
      )}
    </label>
  );
}
