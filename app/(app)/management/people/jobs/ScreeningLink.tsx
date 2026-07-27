"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

// HR sets a single Google Appointment Schedule booking link once; "Request
// screening call" on a candidate emails them this link. No third-party tool.
export default function ScreeningLink({ initialUrl }: { initialUrl: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setMsg(null);
    const res = await fetch("/api/hiring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "settings.setScreeningUrl", url }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed."); return; }
    setMsg("Saved.");
    router.refresh();
  }

  return (
    <Card className="p-4 space-y-2">
      <div className="text-sm font-semibold text-ink">Screening booking link</div>
      <p className="text-xs text-muted">
        Paste your Google Calendar <strong>Appointment Schedule</strong> link. Create it once in Google Calendar
        (Create → Appointment schedule), then paste the public booking URL here. &ldquo;Request screening call&rdquo;
        emails the candidate this link — no third-party scheduler.
      </p>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://calendar.google.com/calendar/appointments/schedules/…"
        className="w-full rounded-lg border border-line px-3 py-2 text-sm"
      />
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button onClick={save} disabled={busy} className={btn.secondary}>{busy ? "Saving…" : "Save link"}</button>
    </Card>
  );
}
