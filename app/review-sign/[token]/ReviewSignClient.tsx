"use client";

import { useMemo, useState } from "react";
import { btn } from "@/components/ui";
import type { ReviewForm as FormDef, ReviewItem } from "@/lib/review-forms";
import { itemsForRole, incompleteQuestionsForRole } from "@/lib/review-forms";

const STATEMENT =
  "I acknowledge that I participated in this review and that it was discussed with me. My signature indicates receipt and participation, not necessarily agreement.";

export default function ReviewSignClient({
  token,
  defaultName,
  form,
  initialResponses,
}: {
  token: string;
  defaultName: string;
  form: FormDef;
  initialResponses: Record<string, string>;
}) {
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [r, setR] = useState<Record<string, string>>(initialResponses ?? {});

  // The reviewee only ever fills their OWN questions, grouped by the sections that
  // contain them (so the context stays readable).
  const sections = useMemo(
    () =>
      form.sections
        .map((s) => ({ title: s.title, items: s.items.filter((it) => it.who === "employee") }))
        .filter((s) => s.items.length > 0),
    [form],
  );
  const hasQuestions = sections.length > 0;

  const incomplete = useMemo(() => incompleteQuestionsForRole(form, r, "employee").length > 0, [form, r]);
  const totalMine = useMemo(() => itemsForRole(form, "employee").length, [form]);
  const answeredMine = useMemo(
    () => itemsForRole(form, "employee").filter((it) => (r[it.key] ?? "").trim()).length,
    [form, r],
  );

  const set = (key: string, v: string) => {
    setR((s) => ({ ...s, [key]: v }));
    setSaved(false);
  };

  async function save(): Promise<boolean> {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/review-sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", token, responses: r }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not save your answers.");
      return false;
    }
    setSaved(true);
    return true;
  }

  async function sign() {
    if (!name.trim()) return setError("Type your full name to sign.");
    if (!agree) return setError("Please check the box to agree and sign.");
    setBusy(true);
    setError(null);
    // Save answers first so the server's completeness check sees them.
    if (hasQuestions) {
      const ok = await save();
      if (!ok) {
        setBusy(false);
        return;
      }
    }
    const res = await fetch("/api/review-sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sign", token, signerName: name, agree }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not sign.");
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
        <div className="text-emerald-700 text-lg font-semibold">Signed</div>
        <p className="mt-1 text-sm text-emerald-800">
          Thank you, {name}. Your answers and signature have been recorded. It now returns to HR for final approval. You
          may close this page.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      {hasQuestions ? (
        <div className="mb-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium text-slate-900">Your questions</div>
            <div className="text-xs text-slate-500 tabular-nums">
              {answeredMine}/{totalMine} answered
            </div>
          </div>
          <p className="text-xs text-slate-600 mb-2">Please answer your questions below, then sign.</p>
          <div className="space-y-3">
            {sections.map((section) => (
              <div key={section.title}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{section.title}</div>
                <div className="mt-1 space-y-2">
                  {section.items.map((it) => (
                    <SignItem key={it.key} it={it} value={r[it.key] ?? ""} onChange={(v) => set(it.key, v)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {saving ? "Saving…" : saved ? "Saved" : "Save answers"}
          </button>
        </div>
      ) : null}

      <div className="text-sm font-medium text-slate-900 mb-1">Sign as the employee</div>
      <p className="text-xs text-slate-600 italic mb-3">&ldquo;{STATEMENT}&rdquo;</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Type your full name"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
      />
      <label className="mt-2 flex items-start gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />I have
        read the statement above and I am signing electronically.
      </label>
      {hasQuestions && incomplete ? (
        <p className="mt-2 text-xs text-amber-700 italic">Finish all your questions before you can sign.</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <button onClick={sign} disabled={busy || (hasQuestions && incomplete)} className={`${btn.primary} w-full mt-3`}>
        {busy ? "Signing…" : "E-sign"}
      </button>
    </div>
  );
}

function SignItem({ it, value, onChange }: { it: ReviewItem; value: string; onChange: (v: string) => void }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <div className="text-sm text-slate-800">{it.label}</div>
      {it.type === "yesno" || it.type === "choice" ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(it.type === "yesno" ? ["Yes", "No"] : it.options ?? []).map((opt) => {
            const sel = value === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(opt)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  sel ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : it.type === "number" ? (
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      ) : it.type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      )}
    </div>
  );
}
