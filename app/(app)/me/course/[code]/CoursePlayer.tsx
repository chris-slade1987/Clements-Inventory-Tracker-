"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

// Embedded course + self-service completion. The course page handles its own quiz;
// when the learner is done they record completion here, which writes their progress
// and shows a confirmation. Honor-based (the quiz is client-side), matching how the
// hosted courses already work — a manager can always verify from the module report.
export default function CoursePlayer({
  courseCode,
  courseName,
  contentUrl,
  assigned,
  alreadyComplete,
  isField,
}: {
  courseCode: string;
  courseName: string;
  contentUrl: string | null;
  assigned: boolean;
  alreadyComplete: boolean;
  isField: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"view" | "confirm" | "done">(alreadyComplete ? "done" : "view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awarded, setAwarded] = useState<string[]>([]);

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/course-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not record completion.");
      setAwarded(data.awarded ?? []);
      setStage("done");
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "Could not record completion.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* The course itself */}
      {contentUrl ? (
        <div className="mb-4 overflow-hidden rounded-xl border border-line bg-white">
          <iframe
            src={contentUrl}
            title={courseName}
            className="h-[70vh] w-full"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-line bg-surface px-4 py-10 text-center text-sm text-muted">
          This course doesn&rsquo;t have an interactive page yet. Your trainer will cover it with you.
        </div>
      )}

      {/* Completion panel */}
      {stage === "done" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-emerald-600 text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div className="text-base font-semibold text-emerald-900">Course complete</div>
          <p className="mt-1 text-sm text-emerald-800">
            {alreadyComplete && stage === "done" && awarded.length === 0
              ? `You've completed ${courseName}.`
              : `Nice work — ${courseName} is recorded on your training record.`}
          </p>
          {awarded.length > 0 ? (
            <p className="mt-2 inline-block rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
              🎉 Certification earned: {awarded.join(", ")}
            </p>
          ) : null}
          <div className="mt-4">
            <Link href="/me/training" className={btn.primary}>Back to My Training</Link>
          </div>
        </div>
      ) : isField ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900">
          <span className="font-medium">Field sign-off</span> — this isn&rsquo;t a quiz. You complete the task in the field with a trainer, who records and approves the sign-off. Nothing to submit here.
        </div>
      ) : !assigned ? (
        <div className="rounded-xl border border-line bg-surface px-4 py-4 text-sm text-muted">
          You&rsquo;re previewing this course — it isn&rsquo;t assigned to you, so there&rsquo;s nothing to record. If you think it should be assigned, ask your supervisor.
        </div>
      ) : stage === "view" ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-4">
          <div className="text-sm font-medium text-ink">Finished the course?</div>
          <p className="mt-0.5 text-[13px] text-muted">Work through the whole course above (including the check at the end). When you&rsquo;re done, record it here and it&rsquo;ll show on your training record.</p>
          <button type="button" onClick={() => setStage("confirm")} className={`${btn.primary} mt-3`}>I&rsquo;ve completed this course</button>
        </div>
      ) : (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-4">
          <div className="text-sm font-medium text-ink">Record completion of {courseName}?</div>
          <p className="mt-0.5 text-[13px] text-muted">This marks the course complete on your training record. If a module has no other courses left, it&rsquo;ll finish and check your certification. A grade, if this course is graded, is recorded by your trainer — not here.</p>
          {error ? <p className="mt-2 text-[13px] text-red-600">{error}</p> : null}
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={record} disabled={busy} className={`${btn.primary}`}>{busy ? "Recording…" : "Confirm & record"}</button>
            <button type="button" onClick={() => { setStage("view"); setError(null); }} disabled={busy} className={btn.secondary}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
