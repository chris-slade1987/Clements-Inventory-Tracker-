"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

// One-click: remind every outstanding employee to acknowledge the handbook.
// Logged-in employees get an in-app Inbox nudge to /resources/handbook; everyone
// else gets a one-time signing link emailed to them.
export default function RemindAllButton({ outstanding }: { outstanding: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remind() {
    if (outstanding === 0) return;
    if (!confirm(`Remind all ${outstanding} outstanding employee${outstanding === 1 ? "" : "s"} to acknowledge the handbook?`)) return;
    setBusy(true); setError(null); setMsg(null);
    const res = await fetch("/api/documents/ack-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remind_all" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not send reminders.");
    const parts = [
      data.inApp ? `${data.inApp} in-app` : null,
      data.emailed ? `${data.emailed} emailed` : null,
      data.skipped ? `${data.skipped} skipped (no login or email)` : null,
    ].filter(Boolean);
    setMsg(parts.length ? `Reminded: ${parts.join(" · ")}.` : "Everyone is already acknowledged.");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={remind} disabled={busy || outstanding === 0} className={`${btn.secondary} disabled:opacity-50`}>
        {busy ? "Reminding…" : `Remind all outstanding${outstanding ? ` (${outstanding})` : ""}`}
      </button>
      {msg ? <p className="text-xs text-emerald-700">{msg}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
