"use client";

import { useState } from "react";
import { Card, btn } from "@/components/ui";

export default function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not change your password.");
    setCurrent(""); setNext(""); setConfirm(""); setDone(true);
  }

  return (
    <Card className="p-4 max-w-md">
      {done ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
          Your password has been changed. Use it next time you sign in.
        </div>
      ) : null}
      <div className="space-y-3">
        <Field label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <Field label="New password (min 8 characters)" value={next} onChange={setNext} autoComplete="new-password" />
        <Field label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button onClick={submit} disabled={busy} className={btn.primary}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </div>
    </Card>
  );
}

function Field({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted mb-1">{label}</span>
      <input
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
      />
    </label>
  );
}
