"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, btn } from "@/components/ui";
import { STAGE_LABELS, INTERVIEW_TYPE_LABELS } from "@/lib/ats-config";

type Interviewer = { id: string; name: string; email: string; branch: string | null };

export type CandidateActionData = {
  candidateId: string;
  jobId: string | null;
  stage: string;
  role: "hr" | "supervisor";
  interviewers: Interviewer[];
  exclusionReasons: string[];
  reactivateStages: { value: string; label: string }[];
  screeningNotes: string | null;
  screeningRequestedAt: string | null;
  screeningCompletedAt: string | null;
  interviewAt: string | null;
  bookingConfigured: boolean;
  scorecardInterviewId: string | null;
  excludedReason: string | null;
  excludedStageLabel: string | null;
  keepWarm: boolean;
  screeningTemplate: ScreeningTemplate | null;
  screeningResponses: Record<string, string | number | null>;
};

export type ScreeningQuestion = { id: string; section: string | null; text: string; responseType: string };
export type ScreeningTemplate = { id: string; name: string; questions: ScreeningQuestion[] };

// Convert a Date to the value a <input type="datetime-local"> expects.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export default function CandidateActions(props: CandidateActionData) {
  const router = useRouter();
  const { candidateId, stage, role } = props;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [assign, setAssign] = useState(false);

  async function post(api: "ats" | "hiring", action: string, extra: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return null;
    setBusy(action); setError(null); setMsg(null);
    const res = await fetch(`/api/${api}`, {
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

  const isExcluded = stage === "excluded" || stage === "rejected";
  const isSupervisor = role === "supervisor";

  // ---- Supervisor container (interview-only) -------------------------------
  if (isSupervisor) {
    return (
      <Card className="p-4 space-y-4">
        <div className="text-sm font-medium text-ink">Interview actions</div>
        <p className="text-xs text-muted">
          You&rsquo;re the assigned interviewing supervisor. Log the confirmed interview time, complete the
          standardized questionnaire, then submit rankings from the job page. Selection is made by HR.
        </p>
        {stage === "interviewing" || stage === "ranked" ? (
          <>
            <LogInterviewTime
              candidateId={candidateId}
              initial={toLocalInput(props.interviewAt)}
              busy={busy} onPost={(v) => post("hiring", "candidate.logInterviewTime", { id: candidateId, interviewAt: v })}
            />
            {props.scorecardInterviewId ? (
              <Link href={`/me/interviews/${props.scorecardInterviewId}`} className={btn.primary}>Open interview questionnaire →</Link>
            ) : null}
            <ExcludeControl
              reasons={props.exclusionReasons}
              busy={busy}
              onExclude={(reason, note) => post("hiring", "candidate.exclude", { id: candidateId, reason, note })}
              label="Exclude (e.g. no-show)"
            />
          </>
        ) : (
          <p className="text-xs text-muted">No interview action available at this stage.</p>
        )}
        {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </Card>
    );
  }

  // ---- Excluded: show reason + reactivate (HR) -----------------------------
  if (isExcluded) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">Excluded</span>
          {props.keepWarm ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">Keep warm</span> : null}
        </div>
        <div className="text-sm text-ink">
          <span className="text-muted">Reason: </span>{props.excludedReason ?? "—"}
          {props.excludedStageLabel ? <span className="text-muted"> · cut at {props.excludedStageLabel}</span> : null}
        </div>
        <p className="text-xs text-muted">Nothing was deleted — this candidate is retained in the Excluded archive.</p>
        <ReactivateControl
          stages={props.reactivateStages}
          busy={busy}
          onReactivate={(toStage) => post("hiring", "candidate.reactivate", { id: candidateId, toStage }, "Reactivate this candidate back into the pipeline?")}
        />
        {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </Card>
    );
  }

  // ---- HR container: stage-aware controls ----------------------------------
  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="text-sm font-medium text-ink mb-2">Current stage</div>
        <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700">{STAGE_LABELS[stage] ?? stage}</span>
      </div>

      {stage === "applied" ? (
        <div className="border-t border-line pt-3 space-y-2">
          <button onClick={() => post("hiring", "candidate.shortlist", { id: candidateId })} disabled={busy !== null} className={btn.primary}>
            {busy === "candidate.shortlist" ? "…" : "Shortlist → Screening"}
          </button>
          <p className="text-xs text-muted">Move this applicant into HR screening.</p>
        </div>
      ) : null}

      {stage === "screening" ? (
        <div className="border-t border-line pt-3 space-y-3">
          <div>
            <button onClick={() => post("hiring", "candidate.requestScreening", { id: candidateId })} disabled={busy !== null} className={btn.secondary}>
              {busy === "candidate.requestScreening" ? "Sending…" : "Request screening call"}
            </button>
            <p className="text-xs text-muted mt-1">
              {props.bookingConfigured
                ? "Emails the candidate your Google Appointment Schedule booking link."
                : "Set the screening booking link on the Hiring / Jobs page first — then this emails the candidate the link."}
            </p>
            {props.screeningRequestedAt ? <p className="text-xs text-brand-700 mt-1">Booking link requested {new Date(props.screeningRequestedAt).toLocaleDateString()}.</p> : null}
          </div>
          <ScreeningCall
            template={props.screeningTemplate}
            initialResponses={props.screeningResponses}
            initialNotes={props.screeningNotes ?? ""}
            completed={!!props.screeningCompletedAt}
            busy={busy}
            onSave={(notes, responses, completed) => post("hiring", "candidate.saveScreening", { id: candidateId, notes, responses, completed })}
          />
          <button onClick={() => post("ats", "candidate.setStage", { id: candidateId, stage: "interviewing" })} disabled={busy !== null} className={btn.primary}>
            {busy === "candidate.setStage" ? "…" : "Advance → Interview"}
          </button>
        </div>
      ) : null}

      {stage === "interviewing" ? (
        <div className="border-t border-line pt-3 space-y-3">
          <LogInterviewTime
            candidateId={candidateId}
            initial={toLocalInput(props.interviewAt)}
            busy={busy} onPost={(v) => post("hiring", "candidate.logInterviewTime", { id: candidateId, interviewAt: v })}
          />
          <button onClick={() => { setAssign(true); setError(null); setMsg(null); }} className={btn.secondary}>Assign interview (individual)</button>
          {props.scorecardInterviewId ? (
            <Link href={`/me/interviews/${props.scorecardInterviewId}`} className="block text-sm font-medium text-brand-700 hover:underline">Open interview questionnaire →</Link>
          ) : null}
          <p className="text-xs text-muted">Rankings are submitted from the job page once interviews are complete.</p>
        </div>
      ) : null}

      {stage === "ranked" ? (
        <div className="border-t border-line pt-3 space-y-2">
          <button
            onClick={() => post("hiring", "candidate.selectFinalist", { id: candidateId }, "Select this candidate as the finalist? The other ranked candidates will be warm-rejected (kept warm) automatically.")}
            disabled={busy !== null}
            className={btn.primary}
          >
            {busy === "candidate.selectFinalist" ? "Selecting…" : "Select as finalist"}
          </button>
          <p className="text-xs text-muted">Selecting warm-rejects the other ranked runner-ups and reminds you to reach out directly.</p>
        </div>
      ) : null}

      {stage === "selected" ? (
        <div className="border-t border-line pt-3 space-y-2">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
            Selected finalist{props.interviewAt ? "" : ""}. Reach out to them directly to confirm interest, then move to pre-hire.
          </div>
          <button
            onClick={() => post("hiring", "candidate.moveToPreHire", { id: candidateId }, "Move this finalist to pre-hire? A pre-hire onboarding packet is created and the candidate emailed their magic link.")}
            disabled={busy !== null}
            className={btn.primary}
          >
            {busy === "candidate.moveToPreHire" ? "Starting…" : "Move to pre-hire"}
          </button>
          <p className="text-xs text-muted">Uses the existing pre-hire boundary — paperwork is defined beyond this step.</p>
        </div>
      ) : null}

      {stage === "pre_hire" || stage === "onboarding" || stage === "hired" ? (
        <div className="border-t border-line pt-3">
          <p className="text-sm text-muted">This candidate is at the {STAGE_LABELS[stage] ?? stage} stage — see the Onboarding section below.</p>
        </div>
      ) : null}

      {/* Exclude — always available for active candidates, stage-specific reasons */}
      {!["pre_hire", "onboarding", "hired"].includes(stage) ? (
        <div className="border-t border-line pt-3">
          <ExcludeControl
            reasons={props.exclusionReasons}
            busy={busy}
            onExclude={(reason, note) => post("hiring", "candidate.exclude", { id: candidateId, reason, note })}
            label="Exclude candidate"
          />
        </div>
      ) : null}

      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {assign ? (
        <AssignModal
          candidateId={candidateId}
          interviewers={props.interviewers}
          onClose={() => setAssign(false)}
          onDone={(text) => { setAssign(false); setMsg(text); router.refresh(); }}
        />
      ) : null}
    </Card>
  );
}

function LogInterviewTime({ candidateId, initial, busy, onPost }: { candidateId: string; initial: string; busy: string | null; onPost: (v: string) => void }) {
  const [v, setV] = useState(initial);
  void candidateId;
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-ink">Confirmed interview time</div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm" />
        <button onClick={() => onPost(v ? new Date(v).toISOString() : "")} disabled={busy !== null || !v} className={btn.secondary}>
          {busy === "candidate.logInterviewTime" ? "Saving…" : "Log time"}
        </button>
      </div>
      {initial ? <p className="text-xs text-brand-700">Logged: {new Date(initial).toLocaleString()}</p> : null}
    </div>
  );
}

function ScreeningCall({
  template,
  initialResponses,
  initialNotes,
  completed,
  busy,
  onSave,
}: {
  template: ScreeningTemplate | null;
  initialResponses: Record<string, string | number | null>;
  initialNotes: string;
  completed: boolean;
  busy: string | null;
  onSave: (notes: string, responses: Record<string, string | number | null>, completed: boolean) => void;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [responses, setResponses] = useState<Record<string, string | number | null>>(initialResponses ?? {});
  const setResp = (id: string, v: string | number | null) => setResponses((s) => ({ ...s, [id]: v }));

  // Group template questions by section for a tidy call script.
  const groups: { section: string; qs: ScreeningQuestion[] }[] = [];
  for (const q of template?.questions ?? []) {
    const section = q.section || "Questions";
    let g = groups.find((x) => x.section === section);
    if (!g) { g = { section, qs: [] }; groups.push(g); }
    g.qs.push(q);
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-ink">
        Screening call {template ? <span className="text-xs font-normal text-muted">· {template.name}</span> : null}
        {completed ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Completed</span> : null}
      </div>

      {template ? (
        <div className="space-y-3 rounded-lg border border-line bg-black/[0.015] p-3">
          {groups.map((g) => (
            <div key={g.section} className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{g.section}</div>
              {g.qs.map((q) => (
                <div key={q.id} className="space-y-1">
                  <div className="text-sm text-ink">{q.text}</div>
                  {q.responseType === "rating_1_5" ? (
                    <div className="flex flex-wrap gap-1">
                      {[1, 2, 3, 4, 5].map((n) => {
                        const sel = Number(responses[q.id]) === n;
                        return (
                          <button key={n} type="button" onClick={() => setResp(q.id, n)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${sel ? "bg-emerald-grad text-white shadow" : "border border-line bg-white text-ink hover:bg-black/[0.03]"}`}>{n}</button>
                        );
                      })}
                    </div>
                  ) : q.responseType === "yes_no" || q.responseType === "basics_yesno_unsure" ? (
                    <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
                      {(q.responseType === "basics_yesno_unsure" ? ["yes", "no", "unsure"] : ["yes", "no"]).map((opt) => {
                        const sel = responses[q.id] === opt;
                        return (
                          <button key={opt} type="button" onClick={() => setResp(q.id, opt)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${sel ? "bg-emerald-grad text-white shadow" : "text-slate-600 hover:text-slate-900"}`}>{opt}</button>
                        );
                      })}
                    </div>
                  ) : (
                    <textarea value={String(responses[q.id] ?? "")} onChange={(e) => setResp(q.id, e.target.value)} rows={2} placeholder="Answer / notes…" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-1">
        <div className="text-sm font-medium text-ink">Screening notes</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Overall notes from the screening call…" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
      </div>

      <div className="flex gap-2">
        <button onClick={() => onSave(notes, responses, false)} disabled={busy !== null} className={btn.secondary}>Save notes</button>
        {!completed ? <button onClick={() => onSave(notes, responses, true)} disabled={busy !== null} className={btn.primary}>Save & mark call complete</button> : null}
      </div>
    </div>
  );
}

function ExcludeControl({ reasons, busy, onExclude, label }: { reasons: string[]; busy: string | null; onExclude: (reason: string, note: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return <button onClick={() => setOpen(true)} className={btn.danger}>{label}</button>;
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 space-y-2">
      <div className="text-sm font-medium text-ink">{label}</div>
      <select data-testid="exclude-reason" value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-white">
        <option value="">Choose a reason…</option>
        {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={reason === "Other" ? "Note required for “Other”" : "Optional note"} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className={btn.secondary}>Cancel</button>
        <button
          onClick={() => {
            if (!reason) return setErr("Choose a reason.");
            if (reason === "Other" && !note.trim()) return setErr("A note is required for “Other”.");
            onExclude(reason, note);
          }}
          disabled={busy !== null}
          className={btn.danger}
        >
          {busy === "candidate.exclude" ? "Excluding…" : "Confirm exclude"}
        </button>
      </div>
    </div>
  );
}

function ReactivateControl({ stages, busy, onReactivate }: { stages: { value: string; label: string }[]; busy: string | null; onReactivate: (toStage: string) => void }) {
  const [toStage, setToStage] = useState(stages[0]?.value ?? "applied");
  return (
    <div className="rounded-lg border border-line bg-black/[0.02] p-3 space-y-2">
      <div className="text-sm font-medium text-ink">Reactivate</div>
      <p className="text-xs text-muted">Return this candidate to the pipeline (e.g. if the selected pick falls through).</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={toStage} onChange={(e) => setToStage(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm bg-white">
          {stages.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button onClick={() => onReactivate(toStage)} disabled={busy !== null} className={btn.primary}>
          {busy === "candidate.reactivate" ? "…" : "Reactivate"}
        </button>
      </div>
    </div>
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
              <button key={t} type="button" onClick={() => setType(t)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${type === t ? "bg-emerald-grad text-white shadow" : "text-slate-600 hover:text-slate-900"}`}>
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
