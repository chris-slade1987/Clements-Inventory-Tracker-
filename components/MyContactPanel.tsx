"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import Glyph from "@/components/Glyph";

type Contact = {
  personalPhone: string;
  personalEmail: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
};

// Self-service contact + emergency-contact editor on /me/profile. Starts read-only
// (what's on file) with an Edit toggle; saving writes the employee's OWN record
// via /api/me/profile. Work email, branch and role are HR-managed and not shown
// here. Keeps field-safety info current without an HR phone loop.
export default function MyContactPanel({ initial }: { initial: Contact }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Contact>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof Contact>(k: K, v: string) {
    setF((s) => ({ ...s, [k]: v }));
    setSaved(false);
  }

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/me/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save.");
    setSaved(true);
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setF(initial);
    setEditing(false);
    setError(null);
  }

  return (
    <Card className="p-0 overflow-hidden mb-5">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600"><Glyph name="shield" className="h-4 w-4" /></span>
          <div className="text-sm font-medium text-ink">Contact &amp; emergency</div>
        </div>
        {!editing ? (
          <button onClick={() => { setEditing(true); setSaved(false); }} className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
        ) : null}
      </div>

      {!editing ? (
        <div className="p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <ReadField label="Personal phone" value={initial.personalPhone} />
            <ReadField label="Personal email" value={initial.personalEmail} />
            <ReadField label="Emergency contact" value={initial.emergencyName} />
            <ReadField label="Relationship" value={initial.emergencyRelationship} />
            <ReadField label="Emergency phone" value={initial.emergencyPhone} />
          </dl>
          <p className="mt-3 text-xs text-muted">You can keep these up to date yourself. Work email, branch and role are managed by HR.</p>
          {saved ? <p className="mt-2 text-sm text-emerald-700">Saved.</p> : null}
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Personal phone" type="tel" value={f.personalPhone} onChange={(v) => set("personalPhone", v)} />
            <Field label="Personal email" type="email" value={f.personalEmail} onChange={(v) => set("personalEmail", v)} />
          </div>
          <div className="border-t border-line pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Emergency contact</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" value={f.emergencyName} onChange={(v) => set("emergencyName", v)} />
              <Field label="Relationship" value={f.emergencyRelationship} onChange={(v) => set("emergencyRelationship", v)} />
              <Field label="Phone" type="tel" value={f.emergencyPhone} onChange={(v) => set("emergencyPhone", v)} />
            </div>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex gap-2 pt-1">
            <button onClick={cancel} disabled={busy} className={btn.secondary}>Cancel</button>
            <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink break-words">{value || "—"}</dd>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    </label>
  );
}
