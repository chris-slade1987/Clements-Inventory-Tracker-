"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, EmptyState, btn } from "@/components/ui";
import {
  COURSE_STATUS_LABEL,
  type EmployeeRecord,
  type EmployeeAssignmentView,
} from "@/lib/training-center-types";

const STATUS_CHIP: Record<string, string> = {
  assigned: "bg-slate-100 text-slate-700",
  in_progress: "bg-amber-100 text-amber-800",
  complete: "bg-emerald-100 text-emerald-800",
  credited: "bg-emerald-50 text-emerald-700",
  not_started: "bg-slate-100 text-slate-500",
};

export default function EmployeeRecordClient({ record }: { record: EmployeeRecord }) {
  const router = useRouter();
  const employeeId = record.employee.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function post(url: string, body: unknown, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Action failed.");
      if (Array.isArray(data.awarded) && data.awarded.length > 0)
        setNotice(`Certification awarded: ${data.awarded.join(", ")}.`);
      else setNotice("Saved.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

      {/* Certifications held */}
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold text-ink">Certifications held</div>
        {record.awards.length === 0 ? (
          <p className="text-sm text-muted">No certifications awarded yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {record.awards.map((a) => (
              <span key={a.code} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                <span className="font-semibold">{a.code}</span>
                {a.name}
                <span className="text-emerald-600">· {a.awardedAt}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Active assignments */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink">Active assignments</h2>
        {record.activeAssignments.length === 0 ? (
          <EmptyState title="No active assignments" hint="Use the Assign tab to assign a module or a single course." />
        ) : (
          <div className="space-y-3">
            {record.activeAssignments.map((a) => (
              <AssignmentCard
                key={a.id}
                a={a}
                employeeId={employeeId}
                busy={busy}
                onComplete={(courseCode) => post("/api/training-center/progress", { employeeId, courseCode }, `complete:${courseCode}`)}
                onCreateSignoff={(body) => post("/api/training-center/signoff", { action: "create", employeeId, ...body }, `signoff:${body.courseCode}`)}
                onApproveSignoff={(signoffId) => post("/api/training-center/signoff", { action: "approve", signoffId }, `approve:${signoffId}`)}
                signoffs={record.signoffs}
              />
            ))}
          </div>
        )}
      </div>

      {/* Field sign-offs */}
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold text-ink">Field sign-offs</div>
        {record.signoffs.length === 0 ? (
          <p className="text-sm text-muted">No field sign-offs logged.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium text-right">Hours</th>
                  <th className="px-3 py-2 font-medium">Trainer</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {record.signoffs.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3">{s.courseCode ?? s.certCode ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{s.date}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{s.hours ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{s.trainerName ?? "—"}</td>
                    <td className="px-3 py-2">
                      {s.approved ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                          approved{s.approvedByName ? ` · ${s.approvedByName}` : ""}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">pending</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!s.approved ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                          disabled={busy === `approve:${s.id}`}
                          onClick={() => post("/api/training-center/signoff", { action: "approve", signoffId: s.id }, `approve:${s.id}`)}
                        >
                          {busy === `approve:${s.id}` ? "…" : "Approve"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Full history */}
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold text-ink">Course history</div>
        {record.history.length === 0 ? (
          <p className="text-sm text-muted">No course activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Group</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                  <th className="px-3 py-2 font-medium text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {record.history.map((c) => (
                  <tr key={c.code} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-ink">{c.code}</span> <span className="text-muted">{c.name}</span>
                    </td>
                    <td className="px-3 py-2 text-muted">{c.group}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP[c.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {COURSE_STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">{c.completedDate ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{c.score ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function AssignmentCard({
  a,
  busy,
  onComplete,
  onCreateSignoff,
  signoffs,
}: {
  a: EmployeeAssignmentView;
  employeeId: string;
  busy: string | null;
  onComplete: (courseCode: string) => void;
  onCreateSignoff: (body: { courseCode: string; hours?: string; trainerName?: string; note?: string; date?: string }) => void;
  onApproveSignoff: (signoffId: string) => void;
  signoffs: EmployeeRecord["signoffs"];
}) {
  const [signoffFor, setSignoffFor] = useState<string | null>(null);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          {a.moduleCode ? (
            <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{a.moduleCode}</span>
          ) : a.standaloneCourseCode ? (
            <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{a.standaloneCourseCode}</span>
          ) : null}
          <span className="font-medium text-ink">{a.moduleName ?? "Single course"}</span>
          {a.programCode ? <span className="text-xs text-muted">{a.programCode}</span> : null}
        </div>
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {a.completeCount}/{a.totalCount} done
        </span>
      </div>
      {a.prereqNote ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{a.prereqNote}</div>
      ) : null}
      <ol className="space-y-1.5">
        {a.courses.map((c) => (
          <li key={c.code} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{c.code}</span>
            <span className="text-ink">{c.name}</span>
            {c.courseType === "field_signoff" ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">field sign-off</span>
            ) : null}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP[c.status] ?? "bg-slate-100 text-slate-700"}`}>
              {COURSE_STATUS_LABEL[c.status] ?? c.status}
            </span>
            {c.completedDate ? <span className="text-xs text-muted">{c.completedDate}</span> : null}
            <span className="ml-auto flex items-center gap-2">
              {c.status !== "complete" && c.status !== "credited" ? (
                <>
                  <button
                    type="button"
                    className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                    disabled={busy === `complete:${c.code}`}
                    onClick={() => onComplete(c.code)}
                  >
                    {busy === `complete:${c.code}` ? "…" : "Mark complete"}
                  </button>
                  {c.courseType === "field_signoff" ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-sky-700 hover:underline"
                      onClick={() => setSignoffFor(signoffFor === c.code ? null : c.code)}
                    >
                      Log sign-off
                    </button>
                  ) : null}
                </>
              ) : null}
            </span>
            {signoffFor === c.code ? (
              <SignoffForm
                courseCode={c.code}
                busy={busy === `signoff:${c.code}`}
                onSubmit={(body) => {
                  onCreateSignoff(body);
                  setSignoffFor(null);
                }}
                onCancel={() => setSignoffFor(null)}
              />
            ) : null}
          </li>
        ))}
      </ol>
      {a.courses.some((c) => c.courseType === "field_signoff") &&
      signoffs.some((s) => !s.approved && a.courses.some((c) => c.code === s.courseCode)) ? (
        <p className="mt-2 text-xs text-amber-700">A logged field sign-off is awaiting approval (see Field sign-offs below).</p>
      ) : null}
    </Card>
  );
}

function SignoffForm({
  courseCode,
  busy,
  onSubmit,
  onCancel,
}: {
  courseCode: string;
  busy: boolean;
  onSubmit: (body: { courseCode: string; hours?: string; trainerName?: string; note?: string; date?: string }) => void;
  onCancel: () => void;
}) {
  const [hours, setHours] = useState("");
  const [trainerName, setTrainerName] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const f = "rounded-lg border border-line px-2.5 py-2 text-sm bg-surface";
  return (
    <div className="mt-2 w-full rounded-lg border border-line bg-black/[0.02] p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input className={f} type="date" value={date} onChange={(e) => setDate(e.target.value)} placeholder="Date" />
        <input className={f} type="number" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Hours" />
        <input className={f} value={trainerName} onChange={(e) => setTrainerName(e.target.value)} placeholder="Trainer" />
        <input className={f} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={btn.primary}
          disabled={busy}
          onClick={() => onSubmit({ courseCode, hours, trainerName, note, date })}
        >
          {busy ? "Saving…" : "Log sign-off"}
        </button>
        <button type="button" className={btn.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">Logs a pending sign-off; approve it below to award the certification.</p>
    </div>
  );
}
