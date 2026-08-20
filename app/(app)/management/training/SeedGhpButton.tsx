"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

// Admin action: load (or refresh) the August GHP "Roach Identification" course
// directly against the live database — a reliable path that doesn't depend on
// the build-time deploy seed having run.
export default function SeedGhpButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  async function run() {
    setBusy(true); setMsg(null); setErr(false);
    try {
      const res = await fetch("/api/management/course/seed-ghp", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setErr(true); setMsg(d.error ?? "Failed to load the course."); return; }
      setMsg(`${d.created ? "Loaded" : "Refreshed"} · assigned to ${d.assigned} new of ${d.technicians} technician(s)${d.retiredSample ? " · retired old sample" : ""}.`);
      router.refresh();
    } catch (e) {
      setBusy(false); setErr(true); setMsg((e as Error).message);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={run} disabled={busy} className={btn.secondary}>{busy ? "Loading…" : "Load / refresh August GHP course"}</button>
      {msg ? <span className={`text-xs ${err ? "text-red-600" : "text-brand-700"}`}>{msg}</span> : null}
    </div>
  );
}
