"use client";

import { useState } from "react";
import { btn } from "@/components/ui";

// Super-admin affordance on the Email (outbound) tile: send a test message to
// your own mailbox and surface the send result inline. Read-only everywhere else
// on this board — this is the one action, and it only ever emails the requester.
export default function TestEmailButton({ configured }: { configured: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/connections/test-email", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({ ok: true, text: data.message || "Test email sent. Check your inbox." });
      } else {
        setMsg({ ok: false, text: data.error || "Could not send the test email." });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button type="button" onClick={send} disabled={busy} className={btn.secondary}>
        {busy ? "Sending…" : "Send test email to me"}
      </button>
      {!configured ? (
        <p className="mt-2 text-xs text-muted">
          No provider is configured yet — the test will report what still needs to be set.
        </p>
      ) : null}
      {msg ? (
        <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>
      ) : null}
    </div>
  );
}
