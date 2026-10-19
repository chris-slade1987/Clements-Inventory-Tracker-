"use client";

import { useState } from "react";
import { Card, btn } from "@/components/ui";

// Employee Notes (Round 2) — the attributed, timestamped, append-only note log on
// the employee profile. Newest first (author + date/time). An add-note box shows
// only for users the server lets add (managers / HR / leadership / super-admins);
// the POST is re-gated in `addEmployeeNote`. Notes are never edited or deleted.

export type NoteDTO = {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
};

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function EmployeeNotes({
  employeeId,
  initialNotes,
  canAdd,
}: {
  employeeId: string;
  initialNotes: NoteDTO[];
  canAdd: boolean;
}) {
  const [notes, setNotes] = useState<NoteDTO[]>(initialNotes);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const text = body.trim();
    if (!text) {
      setError("Write a note first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not add the note.");
      setNotes((n) => [data.note as NoteDTO, ...n]);
      setBody("");
    } catch (e) {
      setError((e as Error).message || "Could not add the note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="employee-notes" className="p-0 overflow-hidden mb-5 scroll-mt-20">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-ink">Employee notes</div>
        <span className="text-xs text-muted">{notes.length} note{notes.length === 1 ? "" : "s"}</span>
      </div>

      {canAdd ? (
        <div className="px-4 py-3 border-b border-line">
          <label htmlFor="emp-note-body" className="sr-only">Add a note</label>
          <textarea
            id="emp-note-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Add a note — it's stamped with your name and the time, and kept permanently."
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={add} disabled={busy} className={`${btn.primary} px-3 py-2 text-sm`}>
              {busy ? "Adding…" : "Add note"}
            </button>
            <span className="text-[11px] text-muted">Notes are append-only — add a correction rather than editing.</span>
          </div>
        </div>
      ) : null}

      {notes.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">No notes on this profile yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                <span className="font-medium text-ink">{n.authorName}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={n.createdAt}>{stamp(n.createdAt)}</time>
              </div>
              <p className="mt-1 text-sm text-ink whitespace-pre-line">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
