"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { STAGE_LABELS, INTERVIEW_TYPE_LABELS } from "@/lib/ats-config";

type Interviewer = { id: string; name: string; email: string; branch: string | null };

// Ordered pipeline stages the HR user can flip directly (onboarding + terminal
// states are handled by their own dedicated buttons below).
const PIPELINE = ["applied", "screening", "interviewing", "offer"];

export default function CandidateActions({
  candidateId,
  stage,
  interviewers,
}: {
  candidateId: string;
  stage: string;
  interviewers: Interviewer[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [assign, setAssign] = useState(false);

  async function post(action: string, extra: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return null;
    setBusy(action); setError(null); setMsg(null);
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

  const terminal = stage === "hired" || stage === "rejected";
  const inOnboarding = stage === "onboarding";

  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="text-sm font-medium text-ink mb-2">Pipeline stage</div>
        <div className="flex flex-wrap gap-1.5">
          {PIPELINE.map((s) => {
            const active = stage === s;
            return (
              <button
                key={s}
                disabled={busy !== null || terminal || inOnboarding}
                onClick={() => post("candidate.setStage", { id: candidateId, stage: s })}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${active ? "bg-emerald-grad text-[#05271c] shadow" : "border border-line bg-white text-ink hover:bg-black/[0.03]"}`}
              >
                {STAGE_LABELS[s]}
              </button>
            );
          })}
          <span className={`rounded-lg px-3 py-1.5 text-xs font-medium ${inOnboarding ? "bg-brand-100 text-brand-700" : stage === "hired" ? "bg-emerald-100 text-emerald-700" : stage === "rejected" ? "bg-red-100 text-red-700" : "hidden"}`}>
            {STAGE_LABELS[stage]}
          </span>
        </div>
      </div>

      {!terminal ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button onClick={() => { setAssign(true); setError(null); setMsg(null); }} className={btn.secondary}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z" /></svg>
            Assign interview
          </button>
          {!inOnboarding ? (
            <button
              onClick={() => post("candidate.moveToOnboarding", { id: candidateId }, "Move this candidate to onboarding? A pre-hire onboarding packet will be created and the candidate emailed their magic link.")}
              disabled={busy === "candidate.moveToOnboarding"}
              className={btn.primary}
            >
              {busy === "candidate.moveToOnboarding" ? "Starting…" : "Move to onboarding"}
            </button>
          ) : null}
          <button
            onClick={() => post("candidate.reject", { id: candidateId }, "Reject this candidate? They'll be marked rejected (nothing is deleted).")}
            disabled={busy === "candidate.reject"}
            className={btn.danger}
          >
            {busy === "candidate.reject" ? "…" : "Reject"}
          </button>
        </div>
      ) : null}

      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {assign ? (
        <AssignModal
          candidateId={candidateId}
          interviewers={interviewers}
          onClose={() => setAssign(false)}
          onDone={(text) => { setAssign(false); setMsg(text); router.refresh(); }}
        />
      ) : null}
    </Card>
  );
}

function AssignModal({
  candidateId,
  interviewers,
  onClose,
  onDone,
}: {
  candidateId: string;
  interviewers: Interviewer[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [interviewerId, setInterviewerId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMins, setDurationMins] = useState("45");
  const [type, setType] = useState<"in_person" | "video">("in_person");
  const [location, setLocation] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!interviewerId) return setError("Choose an interviewer.");
    setBusy(true); setError(null);
    const res = await fetch("/api/ats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "interview.assign",
        candidateId,
        interviewerId,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        durationMins: Number(durationMins) || 45,
        type,
        location: type === "in_person" ? location : null,
        meetingLink: type === "video" ? meetingLink : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not assign the interview.");
    onDone("Interview assigned — the interviewer was emailed the details and a calendar invite.");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">Assign an interview</h3>
        <p className="text-xs text-muted">The interviewer signs in to complete a required scorecard. They get an email with the details and an &ldquo;Add to Google Calendar&rdquo; link.</p>

        <label className="block text-sm font-medium">Interviewer
          <select value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            <option value="">Choose a team member…</option>
            {interviewers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">Date &amp; time
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium">Duration (min)
            <input type="number" min={15} step={15} value={durationMins} onChange={(e) => setDurationMins(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
        </div>

        <div>
          <div className="text-sm font-medium mb-1">Format</div>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
            {(["in_person", "video"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${type === t ? "bg-emerald-grad text-[#05271c] shadow" : "text-slate-600 hover:text-slate-900"}`}>
                {INTERVIEW_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {type === "in_person" ? (
          <label className="block text-sm font-medium">Location
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Vero Beach office…" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
        ) : (
          <label className="block text-sm font-medium">Meeting link
            <input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="Leave blank to add a Google Meet link later" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className={btn.secondary}>Cancel</button>
          <button onClick={submit} disabled={busy || !interviewerId} className={`${btn.primary} flex-1`}>{busy ? "Assigning…" : "Assign & invite"}</button>
        </div>
      </Card>
    </div>
  );
}
