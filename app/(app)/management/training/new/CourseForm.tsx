"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Q = { prompt: string; options: string[]; correctIndex: number };
const blankQ = (): Q => ({ prompt: "", options: ["", ""], correctIndex: 0 });

export type CourseInitial = {
  id: string;
  title: string;
  category: string;
  description: string;
  passingScore: number;
  questions: Q[];
  materialName: string | null;
};

export default function CourseForm({ initial }: { initial?: CourseInitial }) {
  const router = useRouter();
  const editing = !!initial;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "ceu");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [passingScore, setPassingScore] = useState(String(initial?.passingScore ?? 80));
  const [file, setFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<Q[]>(initial?.questions?.length ? initial.questions : [blankQ()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchQ(i: number, patch: Partial<Q>) { setQuestions((s) => s.map((q, x) => (x === i ? { ...q, ...patch } : q))); }
  function patchOpt(qi: number, oi: number, v: string) { setQuestions((s) => s.map((q, x) => (x === qi ? { ...q, options: q.options.map((o, y) => (y === oi ? v : o)) } : q))); }

  async function save() {
    const clean = questions
      .map((q) => ({ prompt: q.prompt.trim(), options: q.options.map((o) => o.trim()).filter(Boolean), correctIndex: q.correctIndex }))
      .filter((q) => q.prompt && q.options.length >= 2);
    if (!title.trim()) return setError("Add a title.");
    if (clean.length === 0) return setError("Add at least one question with 2+ options.");
    // Ensure correctIndex is within range after filtering blanks.
    for (const q of clean) if (q.correctIndex >= q.options.length) q.correctIndex = 0;

    setBusy(true); setError(null);
    const fd = new FormData();
    if (initial) fd.set("id", initial.id);
    fd.set("title", title); fd.set("category", category); fd.set("description", description);
    fd.set("passingScore", passingScore); fd.set("questions", JSON.stringify(clean));
    if (file) fd.set("file", file);
    const res = await fetch("/api/management/course", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    router.push(`/management/training/${data.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium sm:col-span-2">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm font-medium">Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            <option value="ceu">Continuing education (CEU)</option>
            <option value="onboarding">Onboarding</option>
          </select>
        </label>
        <label className="block text-sm font-medium">Passing score (%)
          <input inputMode="numeric" value={passingScore} onChange={(e) => setPassingScore(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm font-medium sm:col-span-2">Lesson body
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={editing ? 16 : 5} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm font-mono leading-relaxed" />
          <span className="mt-1 block text-[11px] font-normal text-muted">Markdown supported — <code>## Heading</code>, <code>**bold**</code>, tables, bullet lists, <code>&gt; callout</code>, and images with <code>![caption](/training/…/photo.png)</code>. It renders as a formatted lesson, not plain text.</span>
        </label>
        <label className="block text-sm font-medium sm:col-span-2">Lesson material (PDF / slides)
          <input type="file" accept="application/pdf,image/*,.ppt,.pptx,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-brand-700" />
          {editing && initial?.materialName ? <span className="mt-1 block text-[11px] font-normal text-muted">Current: {initial.materialName} — upload a new file only to replace it.</span> : null}
        </label>
      </Card>

      <div className="text-sm font-semibold text-ink">Quiz</div>
      {questions.map((q, qi) => (
        <Card key={qi} className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Question {qi + 1}</span>
            {questions.length > 1 ? <button onClick={() => setQuestions((s) => s.filter((_, x) => x !== qi))} className="text-xs text-muted hover:text-red-600">Remove</button> : null}
          </div>
          <input value={q.prompt} onChange={(e) => patchQ(qi, { prompt: e.target.value })} placeholder="Question prompt" className="w-full rounded-lg border border-line px-3 py-2 text-sm font-medium" />
          <div className="space-y-1.5">
            {q.options.map((o, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <input type="radio" name={`correct-${qi}`} checked={q.correctIndex === oi} onChange={() => patchQ(qi, { correctIndex: oi })} title="Mark correct" />
                <input value={o} onChange={(e) => patchOpt(qi, oi, e.target.value)} placeholder={`Option ${oi + 1}`} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm" />
                {q.options.length > 2 ? <button onClick={() => patchQ(qi, { options: q.options.filter((_, y) => y !== oi), correctIndex: Math.min(q.correctIndex, q.options.length - 2) })} className="text-muted hover:text-red-600 px-1">✕</button> : null}
              </div>
            ))}
            <button onClick={() => patchQ(qi, { options: [...q.options, ""] })} className="text-xs font-medium text-brand-700 hover:underline">+ Add option</button>
          </div>
          <p className="text-[11px] text-muted">Select the radio next to the correct answer.</p>
        </Card>
      ))}
      <button onClick={() => setQuestions((s) => [...s, blankQ()])} className={`${btn.secondary} w-full`}>+ Add question</button>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button onClick={() => router.push(editing ? `/management/training/${initial!.id}` : "/management/training")} className={btn.secondary}>Cancel</button>
        <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : editing ? "Save changes" : "Create course"}</button>
      </div>
    </div>
  );
}
