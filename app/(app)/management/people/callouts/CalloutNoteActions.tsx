"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Inline "Mark received / Waive" controls for an outstanding medical note.
// Rendered only for admin/HR (server-gated too); managers never see these.
export default function CalloutNoteActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(noteStatus: "received" | "waived") {
    setBusy(true); setError(null);
    const res = await fetch("/api/absence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolveNote", id, noteStatus }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not update.");
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={() => resolve("received")} disabled={busy} className="rounded-lg bg-emerald-grad px-3 py-1 text-xs font-medium text-[#05271c] disabled:opacity-50">Mark received</button>
      <button onClick={() => resolve("waived")} disabled={busy} className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-ink hover:bg-black/5 disabled:opacity-50">Waive (FMLA/ADA)</button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
