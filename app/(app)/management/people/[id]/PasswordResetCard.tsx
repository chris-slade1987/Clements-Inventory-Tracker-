"use client";

import { useState } from "react";
import { Card, btn } from "@/components/ui";

// Generate a readable, policy-passing temp password (no ambiguous chars).
function generatePassword(): string {
  const words = ["Clements", "Vero", "Stuart", "Orlando", "Naples", "Service", "Fieldwork", "Canopy"];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${w}${n}!`;
}

export default function PasswordResetCard({
  employeeId,
  loginEmail,
  employeeName,
}: {
  employeeId: string;
  loginEmail: string;
  employeeName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPw, setSavedPw] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (pw.length < 8) return setError("Password must be at least 8 characters.");
    setBusy(true);
    const res = await fetch("/api/management/employee/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, newPassword: pw }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not reset the password.");
    setSavedPw(pw);
    setPw("");
    setOpen(false);
  }

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">Login &amp; password</div>
          <div className="text-xs text-muted mt-0.5 truncate">{loginEmail}</div>
        </div>
        <button
          onClick={() => { setOpen((v) => !v); setError(null); setSavedPw(null); setPw(open ? "" : generatePassword()); }}
          className="shrink-0 text-xs font-medium text-brand-700 hover:underline"
        >
          {open ? "Cancel" : "Reset password"}
        </button>
      </div>

      {savedPw ? (
        <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
          Password reset for {employeeName}. Share it securely — it won’t be shown again:
          <span className="ml-1 font-mono font-semibold">{savedPw}</span>
        </div>
      ) : null}

      {open ? (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="block text-xs font-medium text-muted mb-1">New password (min 8 characters)</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface font-mono"
              />
              <button type="button" onClick={() => setPw(generatePassword())} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">
                Generate
              </button>
            </div>
          </label>
          <p className="text-xs text-muted">
            This sets a temporary password for {employeeName}. They can change it themselves anytime under <span className="font-medium">My Account → Change password</span>.
          </p>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button onClick={submit} disabled={busy} className={btn.primary}>
            {busy ? "Resetting…" : "Set password"}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
