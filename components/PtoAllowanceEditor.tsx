"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Inline editor for an employee's annual PTO allotment. Shown on the profile
// to admins, HR, and the employee's branch manager (authorization is enforced
// server-side too).
export default function PtoAllowanceEditor({ employeeId, current }: { employeeId: string; current: number | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current == null ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/pto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setAllowance", employeeId, allowanceDays: value === "" ? null : value }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save.");
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-xs font-medium text-brand-700 hover:underline">
        {current == null ? "Set allotment" : "Edit allotment"}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="days"
        className="w-16 rounded-lg border border-line px-2 py-1 text-sm"
      />
      <button onClick={save} disabled={busy} className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50">{busy ? "…" : "Save"}</button>
      <button onClick={() => { setEditing(false); setValue(current == null ? "" : String(current)); }} className="text-xs text-muted hover:text-ink">Cancel</button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
