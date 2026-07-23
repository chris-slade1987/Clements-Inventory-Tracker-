"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

// Admin-only "Run analysis" — posts to /api/gps/detect (deterministic rules +
// optional AI layer) then refreshes the dashboard so new alerts + counts show.
export default function RunAnalysisButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/gps/detect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Analysis failed.");
      } else {
        const created = data?.detection?.created ?? 0;
        const ai = data?.ai?.issuesFiled ?? 0;
        setMsg(`Done — ${created} alert${created === 1 ? "" : "s"} filed${data?.ai?.aiGenerated ? `, ${ai} AI pattern${ai === 1 ? "" : "s"}` : ""}.`);
        router.refresh();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={run} disabled={busy} className={btn.primary} data-testid="gps-run-analysis">
        {busy ? "Analyzing…" : "Run analysis"}
      </button>
      {msg ? <span className="text-xs text-brand-300">{msg}</span> : null}
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
