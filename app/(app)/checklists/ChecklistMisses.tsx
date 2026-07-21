"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

export type MissDTO = {
  id: string;
  branchLabel: string;
  periodLabel: string;
  cadence: string;
  createdAt: string; // ISO
  clearedByName: string | null;
  clearedAt: string | null; // ISO
  clearNote: string | null;
};

const DATE = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
}

/**
 * Surfaces missed-checklist infractions. Open misses show a "Clear" action with a
 * required note ONLY to users who canClearChecklistMiss (CEO / HR) — everyone else
 * sees a locked notice. Cleared misses are shown as retained history.
 */
export default function ChecklistMisses({
  open,
  cleared,
  canClear,
  showHistory = true,
}: {
  open: MissDTO[];
  cleared: MissDTO[];
  canClear: boolean;
  showHistory?: boolean;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clearMiss(missId: string) {
    if (!note.trim()) return setError("A note is required to clear this.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/checklists/miss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", missId, note: note.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not clear.");
    setActiveId(null);
    setNote("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card className="p-0 overflow-hidden ring-1 ring-red-200" data-testid="missed-checklists">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="text-sm font-medium text-ink">Missed checklists</div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${open.length === 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
            {open.length === 0 ? "None open" : `${open.length} open`}
          </span>
        </div>
        {open.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No open missed-checklist infractions.</p>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((m) => (
              <li key={m.id} className="px-4 py-3" data-testid="open-miss">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">
                      {m.branchLabel} · {m.periodLabel}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      Weekly checklist not signed · flagged {DATE(m.createdAt)} · {ageDays(m.createdAt)} day(s) on record
                    </div>
                  </div>
                  {canClear ? (
                    <button
                      onClick={() => {
                        setActiveId(activeId === m.id ? null : m.id);
                        setNote("");
                        setError(null);
                      }}
                      className="shrink-0 text-xs font-medium text-brand-700 hover:underline"
                      data-testid="clear-miss-btn"
                    >
                      {activeId === m.id ? "Cancel" : "Clear"}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted" data-testid="clear-locked">
                      Only the CEO or HR can clear this.
                    </span>
                  )}
                </div>
                {canClear && activeId === m.id ? (
                  <div className="mt-3">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Required: note the reason / follow-up before clearing"
                      className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
                      rows={2}
                      data-testid="clear-note"
                    />
                    {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
                    <button
                      onClick={() => clearMiss(m.id)}
                      disabled={busy}
                      className={`${btn.primary} mt-2`}
                      data-testid="clear-confirm"
                    >
                      {busy ? "Clearing…" : "Clear with note"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {showHistory && cleared.length > 0 ? (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">
            Cleared infraction history
          </div>
          <ul className="divide-y divide-line">
            {cleared.map((m) => (
              <li key={m.id} className="px-4 py-3" data-testid="cleared-miss">
                <div className="text-sm text-ink">
                  {m.branchLabel} · {m.periodLabel}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  Cleared by <span className="font-medium text-ink">{m.clearedByName}</span>
                  {m.clearedAt ? ` on ${DATE(m.clearedAt)}` : ""}
                  {m.clearNote ? ` — “${m.clearNote}”` : ""}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
