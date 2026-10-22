"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

// Admin-only "load / repair the course catalog" action for when the Certifications
// tab is empty (the deploy seed didn't populate this environment). Calls the reseed
// API and shows the result — including the real error if it fails — right inline.
export default function ReseedCatalogButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const res = await fetch("/api/training-center/reseed", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setErr(data.error ? `${data.error}${data.stack ? ` — ${data.stack}` : ""}` : "Failed."); return; }
      setMsg(`Loaded ${data.certifications} certifications, ${data.courses} courses (${data.coursesWithContent} with content). Refreshing…`);
      setTimeout(() => router.refresh(), 800);
    } catch {
      setBusy(false); setErr("Network error.");
    }
  }

  return (
    <div className="mt-3">
      <button onClick={run} disabled={busy} className={btn.primary}>{busy ? "Loading catalog…" : "Load / repair course catalog"}</button>
      {msg ? <p className="mt-2 text-sm text-brand-700">{msg}</p> : null}
      {err ? <p className="mt-2 text-sm text-red-600 break-words" role="alert">{err}</p> : null}
    </div>
  );
}
