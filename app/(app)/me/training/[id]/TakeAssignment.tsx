"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import type { Question } from "@/lib/training";

export default function TakeAssignment({
  id, completed, passingScore, description, materialFile, materialName, questions, savedAnswers, savedScore,
}: {
  id: string; completed: boolean; passingScore: number;
  description: string | null; materialFile: string | null; materialName: string | null;
  questions: Question[]; savedAnswers: Record<string, number>; savedScore: number | null;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>(savedAnswers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ score: number; passed: boolean; correct: number; total: number } | null>(null);

  // Mark started on first open (if not already completed).
  useEffect(() => {
    if (!completed) fetch("/api/training/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "start" }) }).catch(() => {});
  }, [id, completed]);

  const reviewing = completed || !!result;
  const allAnswered = questions.every((_, i) => answers[String(i)] != null);

  async function submit() {
    if (!allAnswered) return setError("Answer every question first.");
    setBusy(true); setError(null);
    const res = await fetch("/api/training/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "submit", answers }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Submit failed.");
    setResult({ score: data.score, passed: data.passed, correct: data.correct, total: data.total });
    router.refresh();
  }

  return (
    <div className="space-y-4 max-w-3xl pb-8">
      {/* Lesson */}
      <Card className="p-4">
        <div className="text-sm font-medium text-ink mb-1">Lesson</div>
        {description ? <p className="text-sm text-muted whitespace-pre-line">{description}</p> : null}
        {materialFile ? <a href={materialFile} target="_blank" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">📎 Open lesson material{materialName ? ` — ${materialName}` : ""}</a> : null}
        {!description && !materialFile ? <p className="text-sm text-muted">Review the quiz below.</p> : null}
      </Card>

      {(result || completed) ? (
        <Card className={`p-4 ${(result?.passed ?? true) ? "ring-1 ring-brand-300 bg-brand-50/40" : "ring-1 ring-red-300 bg-red-50/40"}`}>
          <div className="text-sm font-medium text-ink">
            {completed && !result ? `Completed — ${savedScore}%` : result?.passed ? `Passed — ${result.score}%` : `Not passed — ${result?.score}% (need ${passingScore}%)`}
          </div>
          <p className="text-xs text-muted mt-0.5">
            {reviewing ? "Correct answers are marked below. A copy was emailed to you." : ""}
            {result && !result.passed ? " You can review the lesson and try again." : ""}
          </p>
        </Card>
      ) : null}

      {/* Quiz */}
      <div className="text-sm font-semibold text-ink">Quiz</div>
      {questions.map((q, qi) => (
        <Card key={qi} className="p-4">
          <div className="text-sm font-medium text-ink mb-2">{qi + 1}. {q.prompt}</div>
          <div className="space-y-1.5">
            {q.options.map((o, oi) => {
              const chosen = answers[String(qi)] === oi;
              const isCorrect = reviewing && oi === q.correctIndex;
              const isWrongChoice = reviewing && chosen && oi !== q.correctIndex;
              return (
                <label key={oi} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${isCorrect ? "border-emerald-400 bg-emerald-50" : isWrongChoice ? "border-red-400 bg-red-50" : chosen ? "border-brand-400" : "border-line"} ${reviewing ? "" : "cursor-pointer hover:border-brand-300"}`}>
                  <input type="radio" name={`q${qi}`} disabled={reviewing} checked={chosen} onChange={() => setAnswers((s) => ({ ...s, [String(qi)]: oi }))} />
                  <span className="flex-1">{o}</span>
                  {isCorrect ? <span className="text-xs font-medium text-emerald-700">correct</span> : null}
                </label>
              );
            })}
          </div>
        </Card>
      ))}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!reviewing ? (
        <button onClick={submit} disabled={busy} className={`${btn.primary} w-full`}>{busy ? "Submitting…" : "Submit quiz"}</button>
      ) : result && !result.passed ? (
        <button onClick={() => { setResult(null); setAnswers({}); }} className={`${btn.primary} w-full`}>Try again</button>
      ) : (
        <button onClick={() => router.push("/me")} className={`${btn.secondary} w-full`}>Back to My Work</button>
      )}
    </div>
  );
}
