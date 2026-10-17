"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { groupByCategory, type ChecklistItem, type ItemResult } from "@/lib/checklists";

type Answer = { checked?: boolean; value?: string; photoRef?: string; note?: string };
type ExistingRecord = { signedName: string; attestation: string; createdAt: string; itemResults: ItemResult[] };

const DATE = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

// The guided SOP runner — a phone-first, resumable, progress-barred flow that
// mirrors the sales goal sheet's sticky stepper (components/GoalPlanner.tsx). Each
// category of the SOP is one stage; a final "Review & sign" stage captures the
// typed-signature attestation. In-progress answers are saved to localStorage so a
// run survives a reload (resumable), and cleared once signed.
export default function SopRunner({
  templateId,
  templateKey,
  intro,
  branch,
  assignmentId,
  steps,
  attestation,
  canSign,
  inactive,
  defaultName,
  existing,
}: {
  templateId: string;
  templateKey: string;
  intro: string | null;
  branch: string;
  assignmentId: string | null;
  steps: ChecklistItem[];
  attestation: string;
  canSign: boolean;
  inactive: boolean;
  defaultName: string;
  existing: ExistingRecord | null;
}) {
  const router = useRouter();
  const groups = useMemo(() => groupByCategory(steps), [steps]);
  const draftKey = `sop-draft:${templateKey}:${branch}:${assignmentId ?? "adhoc"}`;

  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [name, setName] = useState(defaultName ?? "");
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ExistingRecord | null>(existing);

  // Resume an in-progress draft (per-viewer convenience; safe if storage is off).
  useEffect(() => {
    if (saved) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) setAnswers(JSON.parse(raw) as Record<string, Answer>);
    } catch {
      /* storage unavailable — start fresh */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (saved) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(answers));
    } catch {
      /* ignore */
    }
  }, [answers, draftKey, saved]);

  const setAnswer = (id: string, patch: Answer) =>
    setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));

  const isAnswered = (s: ChecklistItem): boolean => {
    const a = answers[s.id] ?? {};
    const type = s.type ?? "check";
    if (type === "check") return a.checked === true;
    if (type === "number" || type === "text") return !!(a.value && a.value.trim());
    return !!((a.photoRef && a.photoRef.trim()) || (a.note && a.note.trim())); // photo
  };

  const answeredCount = steps.filter(isAnswered).length;
  const requiredMissing = steps.filter((s) => s.required && !isAnswered(s));

  // Stages: one per category group, then Review & sign.
  const stageCount = groups.length + 1;
  const reviewIndex = groups.length;

  // ── Read-only signed record (already signed, or just submitted) ──
  if (saved) {
    const byId = new Map(saved.itemResults.map((r) => [r.itemId, r]));
    return (
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-line bg-emerald-50/50">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            </span>
            <div>
              <div className="text-sm font-semibold text-emerald-800">Signed &amp; recorded</div>
              <div className="text-xs text-emerald-700">This is a permanent, non-editable record.</div>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink italic">&ldquo;{saved.attestation}&rdquo;</p>
          <p className="mt-2 text-xs text-muted">
            Signed by <span className="font-medium text-ink">{saved.signedName}</span> on {DATE(saved.createdAt)}
          </p>
        </div>
        <ul className="divide-y divide-line">
          {steps.map((s) => {
            const r = byId.get(s.id);
            return <li key={s.id} className="px-5 py-3"><SignedStep step={s} result={r} /></li>;
          })}
        </ul>
      </Card>
    );
  }

  async function submit() {
    if (!canSign) return setError(inactive ? "This SOP is inactive." : "Only branch managers may sign an SOP.");
    if (requiredMissing.length > 0) {
      setStage(groups.findIndex((g) => g.items.some((it) => it.id === requiredMissing[0].id)));
      return setError(`"${requiredMissing[0].label}" is required before you can sign.`);
    }
    if (!name.trim()) return setError("Type your full name to sign the attestation.");
    setBusy(true);
    setError(null);
    const itemResults: ItemResult[] = steps.map((s) => {
      const a = answers[s.id] ?? {};
      return { itemId: s.id, checked: a.checked === true, note: (a.note ?? "").trim(), value: (a.value ?? "").trim(), photoRef: (a.photoRef ?? "").trim() };
    });
    const res = await fetch("/api/sops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit", templateId, assignmentId, branch, itemResults, signedName: name.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not submit.");
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setSaved({ signedName: name.trim(), attestation, createdAt: new Date().toISOString(), itemResults });
    router.refresh();
  }

  const pct = steps.length ? Math.round((answeredCount / steps.length) * 100) : 0;

  return (
    <div className="max-w-3xl space-y-4 pb-10">
      {intro ? (
        <Card className="px-5 py-3">
          <p className="text-sm text-muted">{intro}</p>
        </Card>
      ) : null}

      {inactive ? (
        <Card className="px-5 py-3 ring-1 ring-amber-200">
          <p className="text-sm text-amber-800">This SOP is inactive and can be viewed but not signed.</p>
        </Card>
      ) : null}

      {/* Sticky stepper + progress (mirrors the goal-sheet stepper) */}
      <div className="sticky top-0 z-20 -mx-1 rounded-xl border border-line bg-canvas/85 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-canvas/70">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">SOP progress</span>
          <span className="text-[11px] font-medium text-ink">{answeredCount} of {steps.length} steps</span>
        </div>
        <div className="mb-2.5 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full bg-emerald-grad transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {groups.map((g, i) => {
            const allDone = g.items.every(isAnswered);
            return (
              <button
                key={g.category}
                type="button"
                onClick={() => setStage(i)}
                className={`flex min-w-0 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${stage === i ? "border-brand-400 bg-brand-50" : allDone ? "border-emerald-200 bg-emerald-50" : "border-line bg-white hover:bg-black/[0.02]"}`}
              >
                <StageBadge n={i + 1} done={allDone} active={stage === i} />
                <span className="truncate text-[11px] font-medium text-ink">{g.category}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setStage(reviewIndex)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors ${stage === reviewIndex ? "border-brand-400 bg-brand-50" : "border-line bg-white hover:bg-black/[0.02]"}`}
          >
            <StageBadge n={stageCount} done={false} active={stage === reviewIndex} />
            <span className="text-[11px] font-medium text-ink">Review &amp; sign</span>
          </button>
        </div>
      </div>

      {/* Current stage */}
      {stage < groups.length ? (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-line bg-black/[0.02] text-[11px] font-semibold uppercase tracking-wider text-muted">
            {groups[stage].category}
          </div>
          <ul className="divide-y divide-line">
            {groups[stage].items.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <StepField step={s} answer={answers[s.id] ?? {}} onChange={(patch) => setAnswer(s.id, patch)} disabled={!canSign} />
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="px-5 py-4">
          <div className="text-sm font-medium text-ink">Sign off — attestation</div>
          <p className="mt-2 text-sm text-ink italic">&ldquo;{attestation}&rdquo;</p>
          <p className="mt-2 text-xs text-muted">
            Type your full name below to sign. Signing creates a permanent, timestamped, non-editable record. It cannot be changed once signed.
          </p>
          {requiredMissing.length > 0 ? (
            <p className="mt-2 text-sm text-amber-700">
              {requiredMissing.length} required step{requiredMissing.length === 1 ? "" : "s"} still need an answer.
            </p>
          ) : null}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Type your full name to sign"
            className="mt-3 w-full rounded-lg border border-line px-3 py-2.5 text-base sm:text-sm bg-surface"
            disabled={!canSign}
          />
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
          <button onClick={submit} disabled={busy || !canSign} className={`${btn.primary} w-full mt-3`}>
            {busy ? "Signing…" : "Sign & submit"}
          </button>
          {!canSign && !inactive ? <p className="mt-2 text-xs text-muted">Only branch managers may sign an SOP.</p> : null}
        </Card>
      )}

      {/* Step navigation */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStage((s) => Math.max(0, s - 1))}
          disabled={stage === 0}
          className={`${btn.secondary} disabled:opacity-40`}
        >
          Back
        </button>
        {stage < reviewIndex ? (
          <button type="button" onClick={() => setStage((s) => Math.min(reviewIndex, s + 1))} className={btn.primary}>
            Next
          </button>
        ) : (
          <span className="text-xs text-muted">Final step</span>
        )}
      </div>
    </div>
  );
}

function StageBadge({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  return (
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${done ? "bg-emerald-600 text-white" : active ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600"}`}>
      {done ? (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
      ) : n}
    </span>
  );
}

// One editable step, rendered by its type.
function StepField({ step, answer, onChange, disabled }: { step: ChecklistItem; answer: Answer; onChange: (patch: Answer) => void; disabled: boolean }) {
  const type = step.type ?? "check";
  const req = step.required ? <span className="ml-1 text-[11px] font-medium text-amber-700">required</span> : null;

  if (type === "check") {
    const checked = answer.checked === true;
    return (
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange({ checked: e.target.checked })}
          className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 accent-emerald-600"
        />
        <span className="flex-1">
          <span className={`block text-[15px] font-semibold ${checked ? "text-brand-700" : "text-ink"}`}>{step.label}{req}</span>
          <span className="block text-xs text-muted mt-0.5">{step.objective}</span>
          {step.help ? <span className="mt-1 block text-[11px] text-muted">{step.help}</span> : null}
        </span>
      </label>
    );
  }

  return (
    <div>
      <div className="text-[15px] font-semibold text-ink">{step.label}{req}</div>
      <div className="text-xs text-muted mt-0.5">{step.objective}</div>
      {step.help ? <div className="mt-1 text-[11px] text-muted">{step.help}</div> : null}
      {type === "text" ? (
        <textarea
          value={answer.value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ value: e.target.value })}
          rows={3}
          placeholder="Type your answer"
          className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-base sm:text-sm disabled:bg-slate-50"
        />
      ) : null}
      {type === "number" ? (
        <input
          type="number"
          inputMode="decimal"
          value={answer.value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="0"
          className="mt-2 w-40 rounded-lg border border-line px-3 py-2.5 text-base sm:text-sm disabled:bg-slate-50"
        />
      ) : null}
      {type === "photo" ? (
        <div className="mt-2 space-y-2">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={disabled}
            onChange={(e) => onChange({ photoRef: e.target.files?.[0]?.name ?? "" })}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
          />
          {answer.photoRef ? <p className="text-[11px] text-emerald-700">Evidence captured: {answer.photoRef}</p> : null}
          <textarea
            value={answer.note ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ note: e.target.value })}
            rows={2}
            placeholder="Describe the evidence (optional)"
            className="w-full rounded-lg border border-line px-3 py-2 text-base sm:text-sm disabled:bg-slate-50"
          />
          <p className="text-[11px] text-muted">Captures the photo&rsquo;s file name as an evidence reference; full photo upload storage is planned.</p>
        </div>
      ) : null}
    </div>
  );
}

// One step in the read-only signed record.
function SignedStep({ step, result }: { step: ChecklistItem; result: ItemResult | undefined }) {
  const type = step.type ?? "check";
  if (type === "check") {
    const ok = result?.checked === true;
    return (
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] ${ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
          {ok ? <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg> : "—"}
        </span>
        <div className="flex-1">
          <div className="text-[15px] font-semibold text-ink">{step.label}</div>
          <div className="text-xs text-muted mt-0.5">{step.objective}</div>
        </div>
      </div>
    );
  }
  const answer = type === "photo" ? [result?.photoRef, result?.note].filter(Boolean).join(" — ") : result?.value;
  return (
    <div>
      <div className="text-[15px] font-semibold text-ink">{step.label}</div>
      <div className="text-xs text-muted mt-0.5">{step.objective}</div>
      <div className="mt-1 text-sm text-ink">{answer ? answer : <span className="text-muted">—</span>}</div>
    </div>
  );
}
