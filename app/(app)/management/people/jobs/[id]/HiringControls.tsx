"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Rankable = { id: string; name: string; rank: number | null; interviewAt: string | null };

export default function HiringControls({
  jobId,
  canManage,
  canOperate,
  supervisors,
  currentSupervisorId,
  currentSupervisorName,
  interviewDeadline,
  rankable,
  hasRanked,
}: {
  jobId: string;
  canManage: boolean;
  canOperate: boolean;
  supervisors: { id: string; name: string }[];
  currentSupervisorId: string | null;
  currentSupervisorName: string | null;
  interviewDeadline: string | null;
  rankable: Rankable[];
  hasRanked: boolean;
}) {
  if (!canManage && !canOperate) return null;
  const showRanking = canOperate && rankable.length > 0;
  const showAssign = canManage;
  if (!showRanking && !showAssign) return null;

  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-2">
      {showAssign ? <AssignSupervisor jobId={jobId} supervisors={supervisors} currentSupervisorId={currentSupervisorId} currentSupervisorName={currentSupervisorName} interviewDeadline={interviewDeadline} /> : null}
      {showRanking ? <SubmitRankings jobId={jobId} rankable={rankable} hasRanked={hasRanked} /> : null}
    </div>
  );
}

function toLocalDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function AssignSupervisor({ jobId, supervisors, currentSupervisorId, currentSupervisorName, interviewDeadline }: { jobId: string; supervisors: { id: string; name: string }[]; currentSupervisorId: string | null; currentSupervisorName: string | null; interviewDeadline: string | null }) {
  const router = useRouter();
  const [supervisorId, setSupervisorId] = useState(currentSupervisorId ?? "");
  const [deadline, setDeadline] = useState(toLocalDate(interviewDeadline));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assigned = !!currentSupervisorId;
  const changing = assigned && supervisorId !== "" && supervisorId !== currentSupervisorId;

  async function submit() {
    if (!supervisorId) return setError("Choose a supervisor.");
    setBusy(true); setError(null); setMsg(null);
    const res = await fetch("/api/hiring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "job.assignSupervisor", jobId, supervisorId, deadline: deadline ? new Date(`${deadline}T17:00:00`).toISOString() : null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not assign the supervisor.");
    if (data.reassigned) {
      setMsg(`Reassigned from ${data.previousSupervisorName ?? "the previous supervisor"} to ${data.supervisorName}. ${data.revoked ?? 0} open assignment(s) pulled back; ${data.handed ?? 0} candidate(s) handed to ${data.supervisorName} and notified.`);
    } else {
      setMsg(`Assigned to ${data.supervisorName ?? "supervisor"} — ${data.handed ?? 0} candidate(s) handed off and notified.`);
    }
    router.refresh();
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink">Interview handoff</div>
        {assigned ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Assigned: {currentSupervisorName ?? "supervisor"}</span> : null}
      </div>
      <p className="text-xs text-muted">
        {assigned
          ? <>Currently assigned to <strong>{currentSupervisorName ?? "a supervisor"}</strong>. Need someone else? Pick a different manager and reassign — the previous supervisor is pulled off (their open assignments are cancelled and access removed) and the new one is handed every <strong>Interview</strong>-stage candidate and notified. Completed scorecards are kept.</>
          : <>Assign the interviewing supervisor and set the deadline interviews must be scheduled by. Every candidate in the <strong>Interview</strong> stage is handed off and the supervisor is notified.</>}
      </p>
      <label className="block text-sm font-medium">Interviewing supervisor
        <select data-testid="supervisor-select" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
          <option value="">Choose a manager…</option>
          {supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === currentSupervisorId ? " (current)" : ""}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">Interview deadline
        <input data-testid="deadline-input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </label>
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button onClick={submit} disabled={busy} className={btn.primary}>{busy ? "Saving…" : changing ? "Reassign & notify" : assigned ? "Update assignment" : "Assign & notify supervisor"}</button>
    </Card>
  );
}

function SubmitRankings({ jobId, rankable, hasRanked }: { jobId: string; rankable: Rankable[]; hasRanked: boolean }) {
  const router = useRouter();
  // rank map: candidateId -> position (1..n) or "" (unranked)
  const [ranks, setRanks] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of rankable) init[c.id] = c.rank ? String(c.rank) : "";
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const positions = Array.from({ length: rankable.length }, (_, i) => String(i + 1));

  async function submit() {
    setError(null); setMsg(null);
    // Build ordered list from chosen positions.
    const chosen = rankable
      .map((c) => ({ id: c.id, pos: Number(ranks[c.id]) }))
      .filter((x) => x.pos >= 1)
      .sort((a, b) => a.pos - b.pos);
    const positionsUsed = chosen.map((c) => c.pos);
    if (new Set(positionsUsed).size !== positionsUsed.length) return setError("Each rank position can be used only once.");
    const orderedIds = chosen.map((c) => c.id);
    setBusy(true);
    const res = await fetch("/api/hiring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "job.submitRankings", jobId, orderedIds }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not submit rankings.");
    setMsg(`Rankings submitted — HR, the CEO and you were notified. HR has 48 hours to select the finalist.`);
    router.refresh();
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="text-sm font-semibold text-ink">Forced ranking</div>
      <p className="text-xs text-muted">Rank the interviewed candidates. At least the top 3 are required (or all, if fewer). No-shows must be excluded first. Submitting opens a 48-hour selection window and notifies HR + the CEO.</p>
      <ul className="space-y-1.5">
        {rankable.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <select
              data-testid="rank-select"
              value={ranks[c.id] ?? ""}
              onChange={(e) => setRanks((s) => ({ ...s, [c.id]: e.target.value }))}
              className="rounded-lg border border-line px-2 py-1.5 text-sm bg-white w-20"
            >
              <option value="">—</option>
              {positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="text-sm text-ink">{c.name}</span>
          </li>
        ))}
      </ul>
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button onClick={submit} disabled={busy} className={btn.primary}>{busy ? "Submitting…" : hasRanked ? "Re-submit rankings" : "Submit rankings"}</button>
    </Card>
  );
}
