"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { JOB_STATUS_LABELS, STAGE_LABELS } from "@/lib/ats-config";

type Cand = { id: string; name: string; stage: string };

// Stages that make a candidate the likely hire (default the close-out select).
const HIRE_PRIORITY = ["hired", "onboarding", "offer"];

export default function JobLifecycle({
  id,
  status,
  candidates,
  hiredName,
}: {
  id: string;
  status: string;
  candidates: Cand[];
  hiredName: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const active = status === "open" || status === "on_hold";

  async function post(action: string, extra: Record<string, unknown>) {
    setBusy(action); setError(null);
    const res = await fetch("/api/ats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(data.error ?? "Something went wrong."); return null; }
    router.refresh();
    return data;
  }

  if (active) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-medium text-ink">Job status</div>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
            {(["open", "on_hold"] as const).map((s) => {
              const sel = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => post("job.update", { id, status: s })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${sel ? "bg-emerald-grad text-[#05271c] shadow" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {JOB_STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
          <button onClick={() => { setClosing(true); setError(null); }} className={`${btn.primary} ml-auto`}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            Close out hiring
          </button>
        </div>
        <p className="text-xs text-muted">Closing out notifies everyone who interviewed for this role which candidate was hired, archives the completed hiring to HR, and removes interviewers&rsquo; access to this job.</p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {closing ? (
          <CloseOutModal
            id={id}
            candidates={candidates}
            onClose={() => setClosing(false)}
            onDone={() => { setClosing(false); router.refresh(); }}
          />
        ) : null}
      </Card>
    );
  }

  // Filled / closed — show the outcome and offer a reopen.
  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${status === "filled" ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600"}`}>
          {JOB_STATUS_LABELS[status] ?? status}
        </span>
        {hiredName ? (
          <span className="text-sm text-ink"><span className="text-muted">Hired:</span> <span className="font-medium">{hiredName}</span></span>
        ) : (
          <span className="text-sm text-muted">Closed without a hire</span>
        )}
        <button
          onClick={() => post("job.reopen", { jobId: id })}
          disabled={busy !== null}
          className={`${btn.secondary} ml-auto`}
        >
          {busy === "job.reopen" ? "Reopening…" : "Reopen"}
        </button>
      </div>
      <p className="text-xs text-muted">This hiring is archived to HR. Reopening restores the job to Open and gives interviewers access again.</p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </Card>
  );
}

function CloseOutModal({
  id,
  candidates,
  onClose,
  onDone,
}: {
  id: string;
  candidates: Cand[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Default to the furthest-along candidate, if any.
  const preferred = [...candidates].sort(
    (a, b) => (HIRE_PRIORITY.indexOf(a.stage) === -1 ? 99 : HIRE_PRIORITY.indexOf(a.stage)) - (HIRE_PRIORITY.indexOf(b.stage) === -1 ? 99 : HIRE_PRIORITY.indexOf(b.stage)),
  )[0];
  const [choice, setChoice] = useState<string>(
    preferred && HIRE_PRIORITY.includes(preferred.stage) ? preferred.id : "__none__",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const res = await fetch("/api/ats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "job.closeOut", jobId: id, hiredCandidateId: choice === "__none__" ? null : choice }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not close out the hiring.");
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">Which candidate was hired?</h3>
        <p className="text-xs text-muted">This notifies everyone who interviewed for this role which candidate was hired, archives the completed hiring to HR, and removes interviewers&rsquo; access to this job.</p>

        <label className="block text-sm font-medium">Hired candidate
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name} · {STAGE_LABELS[c.stage] ?? c.stage}</option>
            ))}
            <option value="__none__">No hire — close position</option>
          </select>
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className={btn.secondary}>Cancel</button>
          <button onClick={submit} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Closing out…" : "Close out hiring"}</button>
        </div>
      </Card>
    </div>
  );
}
