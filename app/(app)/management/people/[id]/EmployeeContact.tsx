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

type Fields = { email: string; phone: string; personalPhone: string; personalEmail: string; nickname: string; title: string; division: string; branch: string; role: string; birthMonth: string; birthDay: string; birthYear: string; status: string; hireDate: string };

type BranchOption = { key: string; label: string };

// "Jun 1" from month (1-12) + day strings; empty/invalid -> "—". This is the HR
// profile, so when a birth YEAR is on file we show the full date ("Jun 1, 1975").
// The year is HR-only and is never surfaced on the team view or any celebration.
function fmtBirthday(month: string, day: string, year: string): string {
  const m = parseInt(month, 10); const d = parseInt(day, 10);
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return "—";
  const y = parseInt(year, 10);
  return Number.isInteger(y) ? `${MONTH_ABBR[m - 1]} ${d}, ${y}` : `${MONTH_ABBR[m - 1]} ${d}`;
}

export default function EmployeeContact({
  id,
  canEdit,
  canEditOrg,
  branches,
  initial,
  emailConfigured,
}: {
  id: string;
  canEdit: boolean;
  // Super admins may change branch + role (promote / transfer); everyone else
  // sees those two fields read-only.
  canEditOrg: boolean;
  branches: BranchOption[];
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
          <button onClick={() => setEditing(true)} className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
        ) : null}
      </div>

      {editing ? (
        <>
          <div className="space-y-2">
            <InputRow label="Nickname" v={f.nickname} on={(v) => setF({ ...f, nickname: v })} placeholder="Known-by name (for roster matching)" />
            <InputRow label="Work email" v={f.email} on={(v) => setF({ ...f, email: v })} placeholder="name@clementspestcontrol.com" type="email" />
            <InputRow label="Personal email" v={f.personalEmail} on={(v) => setF({ ...f, personalEmail: v })} placeholder="name@gmail.com" type="email" />
            <InputRow label="Work phone" v={f.phone} on={(v) => setF({ ...f, phone: v })} type="tel" placeholder="(772) 555-0100" />
            <InputRow label="Personal phone" v={f.personalPhone} on={(v) => setF({ ...f, personalPhone: v })} type="tel" placeholder="(772) 555-0100" />
            <InputRow label="Title" v={f.title} on={(v) => setF({ ...f, title: v })} />
            <InputRow label="Department / Division" v={f.division} on={(v) => setF({ ...f, division: v })} placeholder="Service, Lawn, General Pest…" />
            {/* Branch + role transfer — editable by super admins only; read-only otherwise. */}
            {canEditOrg ? (
              <BranchRow label="Branch" value={f.branch} branches={branches} on={(v) => setF({ ...f, branch: v })} />
            ) : (
              <ViewRow label="Branch" v={branchLabelOf(f.branch, branches)} raw />
            )}
            {canEditOrg ? (
              <InputRow label="Role" v={f.role} on={(v) => setF({ ...f, role: v })} placeholder="Technician, Manager, Sales Advisor…" />
            ) : (
              <ViewRow label="Role" v={f.role} />
            )}
            <BirthdayRow month={f.birthMonth} day={f.birthDay} year={f.birthYear} onMonth={(v) => setF({ ...f, birthMonth: v })} onDay={(v) => setF({ ...f, birthDay: v })} onYear={(v) => setF({ ...f, birthYear: v })} />
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
            <ViewRow label="Nickname" v={f.nickname} />
            <ViewRow label="Work email" v={f.email} />
            <ViewRow label="Personal email" v={f.personalEmail} />
            <ViewRow label="Work phone" v={f.phone} />
            <ViewRow label="Personal phone" v={f.personalPhone} />
            <ViewRow label="Title" v={f.title} />
            <ViewRow label="Department / Division" v={f.division} />
            <ViewRow label="Branch" v={branchLabelOf(f.branch, branches)} raw />
            <ViewRow label="Role" v={f.role} />
            <ViewRow label="Birthday" v={fmtBirthday(f.birthMonth, f.birthDay, f.birthYear)} raw />
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

// Birthday editor — Month / Day / Year dropdowns. The year is HR-only (stored
// and shown here only; never on the team view or any celebration). Validation:
// either all blank (no birthday) or a valid month + day; the year is optional.
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const BIRTH_YEARS = Array.from({ length: new Date().getFullYear() - 1940 + 1 }, (_, i) => new Date().getFullYear() - i);
function BirthdayRow({ month, day, year, onMonth, onDay, onYear }: { month: string; day: string; year: string; onMonth: (v: string) => void; onDay: (v: string) => void; onYear: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">Birthday</span>
      <span className="flex w-56 gap-2">
        <select value={month} onChange={(e) => onMonth(e.target.value)} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm text-ink bg-surface">
          <option value="">Month</option>
          {MONTH_ABBR.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </select>
        <select value={day} onChange={(e) => onDay(e.target.value)} className="w-20 rounded-lg border border-line px-2 py-1.5 text-sm text-ink bg-surface">
          <option value="">Day</option>
          {DAYS.map((d) => <option key={d} value={String(d)}>{d}</option>)}
        </select>
        <select value={year} onChange={(e) => onYear(e.target.value)} title="Year (HR only)" className="w-24 rounded-lg border border-line px-2 py-1.5 text-sm text-ink bg-surface">
          <option value="">—</option>
          {BIRTH_YEARS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
      </span>
    </label>
  );
}

// Resolve a branch key ("vero") to its label ("Vero Beach"); empty -> "—".
function branchLabelOf(key: string, branches: BranchOption[]): string {
  if (!key) return "—";
  return branches.find((b) => b.key === key)?.label ?? key;
}

// Branch transfer dropdown (super admins only). Keys are the 4 branch keys.
function BranchRow({ label, value, branches, on }: { label: string; value: string; branches: BranchOption[]; on: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <select value={value} onChange={(e) => on(e.target.value)} className="w-56 rounded-lg border border-line px-2 py-1.5 text-sm text-ink bg-surface">
        <option value="">— none —</option>
        {branches.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
      </select>
    </label>
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
