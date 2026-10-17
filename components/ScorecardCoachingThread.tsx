"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import type { ScorecardCommentDTO } from "@/lib/scorecard-coaching";

// Inline coaching thread on a manager's quarterly scorecard (CanopyOS Theme 6 —
// Accountability). A durable, in-portal coaching log between the reviewer/coach
// and the scored branch manager, mirroring the FocusPlan coaching log. Rendered
// on BOTH /management/scorecards (coach view) and /my-branch/scorecard (the
// manager's view). Emoji-free, thin 1.6 line icons only (brand kit §1/§6) — the
// sanctioned sales-motivation emoji exception does NOT apply to this surface.

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function ScorecardCoachingThread({
  year, quarter, branch, comments, canComment, viewerName,
}: {
  year: number;
  quarter: number;
  branch: string;
  comments: ScorecardCommentDTO[];
  canComment: boolean;
  viewerName: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const body = note.trim();
    if (!body) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/scorecard/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, quarter, branch, body }),
      });
      const d = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setErr(d.error ?? "Could not post the note."); return; }
      setNote("");
      router.refresh();
    } catch (e) {
      setBusy(false);
      setErr((e as Error).message);
    }
  }

  return (
    <Card className="p-4 mt-4 print:hidden">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-brand-600">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
          </svg>
        </span>
        <div className="text-sm font-medium text-ink">Coaching log</div>
        {comments.length ? <span className="text-[11px] text-muted">{comments.length} note{comments.length === 1 ? "" : "s"}</span> : null}
      </div>
      <p className="mb-3 text-xs text-muted">
        The durable coaching conversation on this quarter&rsquo;s scorecard — between the reviewer and the branch manager. Everything here is saved to the record.
      </p>

      <div className="space-y-2">
        {comments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-white/50 px-3 py-4 text-center text-sm text-muted">
            No coaching notes yet. {canComment ? "Add the first note to start the log." : "Your reviewer hasn't left a note yet."}
          </p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-line bg-black/[0.015] px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="font-medium text-ink">{c.authorName}</span>
                <span>{fmtDate(c.createdAt)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{c.body}</p>
            </div>
          ))
        )}
      </div>

      {canComment ? (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={`Add a coaching note as ${viewerName}…`}
            className="w-full rounded-lg border border-line px-3 py-2.5 text-base sm:text-sm"
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={submit} disabled={busy || !note.trim()} className={btn.primary}>
              {busy ? "Posting…" : "Post note"}
            </button>
            {err ? <span className="text-xs text-red-600">{err}</span> : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
