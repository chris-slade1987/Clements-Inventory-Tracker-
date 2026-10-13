"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

// Admin-only "send a real test email" control. Fires through the live provider
// and refreshes the log so the resulting row (sent / skipped / error) shows up.
export default function TestEmail({ defaultTo }: { defaultTo: string }) {
  const router = useRouter();
  const [to, setTo] = useState(defaultTo);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: d.error ?? "Could not send." });
      } else if (d.status === "sent") {
        setMsg({ ok: true, text: `Sent to ${d.to}. Check the inbox (and the row below).` });
      } else if (d.status === "skipped_no_provider") {
        setMsg({ ok: false, text: "No email provider configured — RESEND_API_KEY isn't set in this environment." });
      } else if (d.status === "error") {
        setMsg({ ok: false, text: `Provider error: ${d.error ?? "unknown"}` });
      } else {
        setMsg({ ok: false, text: `Not sent (${d.status}).` });
      }
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 mb-4">
      <div className="text-sm font-semibold text-ink mb-1">Send a test email</div>
      <p className="text-xs text-muted mb-2">Fires a real message through the live provider to confirm Resend + the sending domain work. Logged below like any other email.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="name@company.com"
          className="flex-1 min-w-[16rem] rounded-lg border border-line px-3 py-2 text-sm"
        />
        <button onClick={send} disabled={busy || !to} className={btn.primary}>
          {busy ? "Sending…" : "Send test"}
        </button>
      </div>
      {msg ? <p className={`mt-2 text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p> : null}
    </Card>
  );
}
