"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Clear" a Needs-attention item. A computed item (maintenance due, registration
// expiring, PTO to review, …) is hidden until its situation/date changes; a manual
// reminder is dismissed for good. Managers/HR/admin only (enforced server-side).
export default function ClearReminderButton({ reminderKey, branch }: { reminderKey: string; branch?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function clear() {
    const manual = reminderKey.startsWith("manual:");
    const msg = manual
      ? "Clear this reminder? It will be dismissed for good."
      : "Clear this from Needs attention? It comes back on its own if the situation changes (e.g. a new due date or next month's cycle).";
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear", key: reminderKey, branch: branch ?? null }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={clear} disabled={busy} className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline disabled:opacity-50">
      {busy ? "Clearing…" : "Clear"}
    </button>
  );
}
