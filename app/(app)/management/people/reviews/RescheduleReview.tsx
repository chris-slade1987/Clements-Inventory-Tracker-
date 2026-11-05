"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Delay / postpone / set a new due date for ANY review (super admin / HR director).
// Lives next to "Reassign & notify" on /management/people/reviews. Use case: an
// employee is on prescheduled leave, so push the 30-day review out and it stops
// reading "overdue." Calls POST /api/reviews { action: "reschedule" }.
export default function RescheduleReview({ reviewId, dueDate }: { reviewId: string; dueDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(dueDate.slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!date) return setError("Pick a date.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reschedule", reviewId, dueDate: date }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return setError(d.error ?? "Could not reschedule.");
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setError(null); }}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-black/[0.03]"
      >
        Reschedule
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-lg border border-line px-2 py-1.5 text-sm"
        aria-label="New due date"
      />
      <button
        onClick={save}
        disabled={busy}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save new due date"}
      </button>
      <button onClick={() => { setOpen(false); setError(null); }} disabled={busy} className="text-xs font-medium text-muted hover:text-ink">
        Cancel
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
