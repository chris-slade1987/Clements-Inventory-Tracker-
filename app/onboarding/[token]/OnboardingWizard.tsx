"use client";

import { useMemo, useState } from "react";
import { btn } from "@/components/ui";
import type { PacketStep, Responses, StepResponse } from "@/lib/prehire";

export default function OnboardingWizard({
  token,
  candidateName,
  steps,
  initialResponses,
  initialStep,
}: {
  token: string;
  candidateName: string;
  steps: PacketStep[];
  initialResponses: Responses;
  initialStep: number;
}) {
  const total = steps.length;
  // Clamp entry point: land on the first unfinished step, or the review screen.
  const [idx, setIdx] = useState(Math.min(Math.max(initialStep, 0), total));
  const [responses, setResponses] = useState<Responses>(initialResponses);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const onReview = idx >= total;
  const step = onReview ? null : steps[idx];

  function setStepData(key: string, data: StepResponse) {
    setResponses((r) => ({ ...r, [key]: data }));
  }

  async function saveCurrent(): Promise<boolean> {
    if (!step) return true;
    setError(null);
    const data = responses[step.key] ?? {};

    // Client-side validation mirrors the server so we fail fast with a message.
    if (step.kind === "form") {
      for (const f of step.fields ?? []) {
        if (f.required && !String((data as Record<string, unknown>)[f.key] ?? "").trim()) {
          setError(`Please fill in “${f.label}”.`);
          return false;
        }
      }
    }
    if (step.kind === "acknowledgment") {
      const ack = data.acknowledged ?? {};
      for (const d of step.documents ?? []) {
        if (!ack[d.key]) { setError("Please check each document to acknowledge it."); return false; }
      }
    }
    if (step.requireSignature && !data.signature?.signedName) {
      setError("Type your full name and check the box to sign.");
      return false;
    }

    setBusy(true);
    const res = await fetch(`/api/onboarding/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", stepKey: step.key, data }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "Could not save."); return false; }
    return true;
  }

  async function next() {
    if (await saveCurrent()) setIdx((i) => Math.min(i + 1, total));
  }

  function back() {
    setError(null);
    setIdx((i) => Math.max(i - 1, 0));
  }

  async function submit() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/onboarding/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit" }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "Could not submit."); return; }
    setSubmitted(true);
  }

  const progressPct = useMemo(() => Math.round((Math.min(idx, total) / total) * 100), [idx, total]);

  if (submitted) {
    return (
      <Panel>
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900 text-center">Thanks, {candidateName.split(/\s+/)[0]}!</h2>
        <p className="mt-1 text-sm text-slate-600 text-center">Your onboarding is submitted. Our HR team will review it and be in touch about your next steps. You can close this page.</p>
      </Panel>
    );
  }

  return (
    <Panel>
      {/* Header + progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Welcome, {candidateName}</span>
          <span>{onReview ? "Review" : `Step ${idx + 1} of ${total}`}</span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {onReview ? (
        <Review steps={steps} responses={responses} onEdit={(i) => { setError(null); setIdx(i); }} />
      ) : (
        <StepView step={step!} data={responses[step!.key] ?? {}} onChange={(d) => setStepData(step!.key, d)} />
      )}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-5 flex items-center gap-2">
        {idx > 0 ? <button onClick={back} disabled={busy} className={btn.secondary}>Back</button> : <span />}
        <div className="flex-1" />
        {onReview ? (
          <button onClick={submit} disabled={busy} className={btn.primary}>{busy ? "Submitting…" : "Submit onboarding"}</button>
        ) : (
          <button onClick={next} disabled={busy} className={btn.primary}>{busy ? "Saving…" : idx + 1 === total ? "Save & review" : "Continue"}</button>
        )}
      </div>
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/95 p-5 sm:p-6 shadow-xl">{children}</div>;
}

// ---- One step --------------------------------------------------------------

function StepView({ step, data, onChange }: { step: PacketStep; data: StepResponse; onChange: (d: StepResponse) => void }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{step.title}</h2>
      {step.intro ? <p className="mt-1 text-sm text-slate-600">{step.intro}</p> : null}

      {step.kind === "form" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(step.fields ?? []).map((f) => (
            <label key={f.key} className={`block text-sm font-medium text-slate-800 ${f.half ? "sm:col-span-1" : "sm:col-span-2"}`}>
              {f.label}{f.required ? <span className="text-red-500"> *</span> : null}
              <input
                type={f.type === "tel" ? "tel" : "text"}
                value={String((data as Record<string, unknown>)[f.key] ?? "")}
                onChange={(e) => onChange({ ...data, [f.key]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900"
              />
            </label>
          ))}
        </div>
      ) : null}

      {step.body ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-line max-h-64 overflow-y-auto">
          {step.body}
        </div>
      ) : null}

      {step.note ? <p className="mt-2 text-xs text-slate-500 italic">{step.note}</p> : null}

      {step.kind === "acknowledgment" && step.documents ? (
        <div className="mt-4 space-y-2">
          {step.documents.map((d) => (
            <label key={d.key} className="flex items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={!!data.acknowledged?.[d.key]}
                onChange={(e) => onChange({ ...data, acknowledged: { ...(data.acknowledged ?? {}), [d.key]: e.target.checked } })}
                className="mt-0.5 h-4 w-4"
              />
              {d.label}
            </label>
          ))}
        </div>
      ) : null}

      {step.requireSignature ? (
        <Signature step={step} data={data} onChange={onChange} />
      ) : null}
    </div>
  );
}

function Signature({ step, data, onChange }: { step: PacketStep; data: StepResponse; onChange: (d: StepResponse) => void }) {
  // Local draft so the typed name persists even before the consent box is
  // checked; the shared `signature` is only set once BOTH are complete.
  const [name, setName] = useState(data.signature?.signedName ?? "");
  const [consented, setConsented] = useState(!!data.signature?.consented);

  function update(nextName: string, nextConsent: boolean) {
    setName(nextName);
    setConsented(nextConsent);
    if (nextName.trim() && nextConsent) {
      onChange({ ...data, signature: { signedName: nextName.trim(), consented: true, signedAt: new Date().toISOString() } });
    } else if (data.signature) {
      const rest = { ...data };
      delete rest.signature;
      onChange(rest);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => update(name, e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        {step.consentLabel ?? "I agree."}
      </label>
      <div className="mt-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">Type your full name to sign</label>
        <input
          value={name}
          onChange={(e) => update(e.target.value, consented)}
          placeholder="Full legal name"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900"
        />
      </div>
    </div>
  );
}

// ---- Review ----------------------------------------------------------------

function Review({ steps, responses, onEdit }: { steps: PacketStep[]; responses: Responses; onEdit: (i: number) => void }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">Review &amp; submit</h2>
      <p className="mt-1 text-sm text-slate-600">Please confirm everything looks right, then submit. You can go back to any step to make changes.</p>

      <div className="mt-4 space-y-3">
        {steps.map((step, i) => {
          const r = responses[step.key];
          return (
            <div key={step.key} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-900">{step.title}</div>
                <button onClick={() => onEdit(i)} className="text-xs font-medium text-emerald-700 hover:underline">Edit</button>
              </div>
              <div className="mt-1.5 text-sm text-slate-600">
                {!r ? (
                  <span className="text-amber-600">Not completed yet</span>
                ) : step.kind === "form" ? (
                  <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                    {(step.fields ?? []).map((f) => {
                      const v = String((r as Record<string, unknown>)[f.key] ?? "").trim();
                      if (!v) return null;
                      return <div key={f.key}><span className="text-slate-500">{f.label}: </span>{v}</div>;
                    })}
                  </dl>
                ) : (
                  <div className="space-y-0.5">
                    {step.kind === "acknowledgment" && step.documents
                      ? step.documents.map((d) => (
                          <div key={d.key}>{r.acknowledged?.[d.key] ? "✓" : "—"} {d.label}</div>
                        ))
                      : null}
                    {r.signature?.signedName ? <div className="text-emerald-700">Signed by {r.signature.signedName}</div> : <div className="text-amber-600">Not signed</div>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
