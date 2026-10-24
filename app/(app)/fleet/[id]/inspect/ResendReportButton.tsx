"use client";

import { useState } from "react";

// Resend the filed inspection report to the graded driver AND the person clicking
// (the inspector / viewing manager). Shown on the read-only report for anyone who
// can edit it (managers + admins). Reports the result inline.
export default function ResendReportButton({ inspectionId }: { inspectionId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function resend() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/fleet/inspection/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inspectionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const sent = Object.entries(data.statuses ?? {})
          .filter(([, s]) => String(s).startsWith("sent"))
          .map(([addr]) => addr);
        setMsg({
          ok: true,
          text: sent.length ? `Report sent to ${sent.join(" and ")}.` : "Report sent.",
        });
      } else {
        setMsg({ ok: false, text: data.error || "Could not resend the report." });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-black/5 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Resend report"}
      </button>
      {msg ? <span className={`text-[11px] ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span> : null}
    </span>
  );
}
