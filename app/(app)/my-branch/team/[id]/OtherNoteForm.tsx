"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

// Lightweight "other notes" box — a general comment a manager files on a team
// member's profile. Posts a note-type PersonnelRecord through the shared record
// API, so it lands in the personnel record and is visible on the HR side too.
export default function OtherNoteForm({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!note.trim()) return setError("Type a note first.");
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("employeeId", employeeId);
    fd.set("type", "note");
    fd.set("category", "general");
    fd.set("body", note.trim());
    const res = await fetch("/api/personnel/record", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error ?? "Could not save the note.");
    setNote("");
    setDone(true);
    router.refresh();
  }

  return (
    <Card className="p-4 mt-5">
      <div className="text-sm font-medium text-ink">Other notes</div>
      <p className="mt-0.5 text-xs text-muted">
        File a general note or comment on {employeeName}&rsquo;s profile. It&rsquo;s saved to their personnel record and visible to HR.
      </p>
      <textarea
        value={note}
        onChange={(e) => { setNote(e.target.value); setDone(false); }}
        rows={3}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
        placeholder="Add a note or comment…"
      />
      {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
      {done ? <p className="mt-1 text-sm text-emerald-700">Note saved to the profile.</p> : null}
      <button onClick={submit} disabled={busy} className={`${btn.primary} mt-2`}>{busy ? "Saving…" : "Add note"}</button>
    </Card>
  );
}
