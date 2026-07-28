"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, btn } from "@/components/ui";

type Opt = { id: string; name: string; isDefault: boolean };

export default function JobTemplates({
  jobId,
  interviewTemplates,
  screeningTemplates,
  currentInterviewId,
  currentScreeningId,
  resolvedInterviewName,
  resolvedScreeningName,
}: {
  jobId: string;
  interviewTemplates: Opt[];
  screeningTemplates: Opt[];
  currentInterviewId: string | null;
  currentScreeningId: string | null;
  resolvedInterviewName: string;
  resolvedScreeningName: string;
}) {
  const router = useRouter();
  const [interviewId, setInterviewId] = useState(currentInterviewId ?? "");
  const [screeningId, setScreeningId] = useState(currentScreeningId ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setMsg(null);
    const res = await fetch("/api/hiring/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "job.assignTemplates", jobId, interviewTemplateId: interviewId || null, screeningTemplateId: screeningId || null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save templates.");
    setMsg("Saved. The interview form + screening call now use the assigned templates."); router.refresh();
  }

  return (
    <Card className="p-4 mb-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink">Hiring templates</div>
        <Link href="/management/people/hiring-templates" className="text-xs font-medium text-brand-700 hover:underline">Manage library →</Link>
      </div>
      <p className="text-xs text-muted">Pick the interview + HR screening-call templates for this job. Leave on <em>Auto</em> to use the role-matched template, then the default. The supervisor interview form and the HR screening call render what&rsquo;s assigned here.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Interview template
          <select data-testid="job-interview-template" value={interviewId} onChange={(e) => setInterviewId(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            <option value="">Auto ({resolvedInterviewName})</option>
            {interviewTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? " (default)" : ""}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Screening template
          <select data-testid="job-screening-template" value={screeningId} onChange={(e) => setScreeningId(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
            <option value="">Auto ({resolvedScreeningName})</option>
            {screeningTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? " (default)" : ""}</option>)}
          </select>
        </label>
      </div>
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button onClick={save} disabled={busy} className={btn.secondary}>{busy ? "Saving…" : "Save templates"}</button>
    </Card>
  );
}
