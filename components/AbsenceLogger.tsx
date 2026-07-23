"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";
import { REASONS } from "@/lib/absence";

// The "Attendance / Call-Outs" logger + history. Calendar-based: a start/end
// date-range picker plus a compact month view that highlights this employee's
// absence days. Reason dropdown reveals a required detail for "Other" and a
// required workplace-related Y/N (+ accident link) for a physical injury.
// HR/admin get inline note-resolution (Mark received / Waive); managers see it
// read-only.

type AbsenceView = {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  reasonDetail: string | null;
  excused: boolean | null;
  workplaceRelated: boolean | null;
  accidentRecordId: string | null;
  noteRequired: boolean;
  noteStatus: string;
  noteResolvedBy: string | null;
  loggedByName: string | null;
};

const reasonLabel = (code: string) => REASONS.find((r) => r.code === code)?.label ?? code;
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;

const NOTE_STYLE: Record<string, string> = {
  requested: "bg-amber-100 text-amber-700",
  received: "bg-emerald-100 text-emerald-700",
  waived: "bg-slate-200 text-slate-600",
  none: "bg-slate-100 text-slate-500",
};
const NOTE_LABEL: Record<string, string> = {
  requested: "Note requested",
  received: "Note received",
  waived: "Note waived",
  none: "—",
};

export default function AbsenceLogger({
  employeeId,
  employeeName,
  canManage,
  canResolve,
  accidents,
  absences,
}: {
  employeeId: string;
  employeeName: string;
  canManage: boolean;
  canResolve: boolean;
  accidents: { id: string; label: string }[];
  absences: AbsenceView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [reason, setReason] = useState<string>("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [workplaceRelated, setWorkplaceRelated] = useState<"" | "yes" | "no">("");
  const [accidentRecordId, setAccidentRecordId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Compact month view — highlight days covered by any absence.
  const [viewMonth, setViewMonth] = useState(() => { const n = new Date(); return { y: n.getUTCFullYear(), m: n.getUTCMonth() }; });
  const absenceDays = useMemo(() => {
    const set = new Set<string>();
    for (const a of absences) {
      const s = new Date(a.startDate);
      const e = new Date(a.endDate);
      for (const d = new Date(s); d.getTime() <= e.getTime(); d.setUTCDate(d.getUTCDate() + 1)) set.add(dayKey(d));
    }
    return set;
  }, [absences]);

  function resetForm() {
    setEditId(null); setStart(today()); setEnd(today()); setReason(""); setReasonDetail("");
    setWorkplaceRelated(""); setAccidentRecordId(""); setError(null);
  }

  function beginAdd() { resetForm(); setOpen(true); setMsg(null); }
  function beginEdit(a: AbsenceView) {
    setEditId(a.id);
    setStart(a.startDate.slice(0, 10));
    setEnd(a.endDate.slice(0, 10));
    setReason(a.reason);
    setReasonDetail(a.reasonDetail ?? "");
    setWorkplaceRelated(a.workplaceRelated === true ? "yes" : a.workplaceRelated === false ? "no" : "");
    setAccidentRecordId(a.accidentRecordId ?? "");
    setError(null); setMsg(null); setOpen(true);
  }

  const isInjury = reason === "physical_injury";
  const isOther = reason === "other";

  async function submit() {
    setError(null);
    if (!reason) return setError("Choose a reason.");
    if (isOther && !reasonDetail.trim()) return setError("Add a detail for “Other”.");
    if (isInjury && workplaceRelated === "") return setError("Indicate whether the injury is workplace-related.");
    setBusy(true);
    const res = await fetch("/api/absence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: editId ? "update" : "create",
        id: editId ?? undefined,
        employeeId,
        startDate: start,
        endDate: end,
        reason,
        reasonDetail: reasonDetail.trim() || undefined,
        workplaceRelated: isInjury ? workplaceRelated === "yes" : undefined,
        accidentRecordId: isInjury && workplaceRelated === "yes" ? accidentRecordId || undefined : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    const parts: string[] = [editId ? "Call-out updated." : "Call-out logged."];
    if (data.noteRequired) parts.push("A medical note was requested.");
    if (Array.isArray(data.notified) && data.notified.length > 0) parts.push(`Leadership + HR notified (${data.notified.length}).`);
    setMsg(parts.join(" "));
    setOpen(false); resetForm();
    router.refresh();
  }

  async function resolveNote(id: string, noteStatus: "received" | "waived") {
    setBusy(true); setError(null);
    const res = await fetch("/api/absence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolveNote", id, noteStatus }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not update the note.");
    router.refresh();
  }

  // Month grid cells.
  const first = new Date(Date.UTC(viewMonth.y, viewMonth.m, 1));
  const startPad = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(viewMonth.y, viewMonth.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const shiftMonth = (delta: number) => setViewMonth((v) => { const d = new Date(Date.UTC(v.y, v.m + delta, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium text-ink">Attendance / Call-Outs</div>
        {canManage && !open ? (
          <button onClick={beginAdd} className="text-xs font-medium text-brand-700 hover:underline">Log a call-out</button>
        ) : null}
      </div>
      <p className="text-xs text-muted mb-3">
        Unplanned absences, tracked for attendance patterns. Not PTO — there is no allowance. An illness (employee or family)
        over 2 days requires a medical note.
      </p>

      {/* Compact month view highlighting this employee's absence days */}
      <div className="mb-3 rounded-xl border border-line p-3">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => shiftMonth(-1)} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-black/5" aria-label="Previous month">‹</button>
          <div className="text-xs font-medium text-ink">{monthLabel}</div>
          <button onClick={() => shiftMonth(1)} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-black/5" aria-label="Next month">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted mb-1">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((c, i) => {
            if (c == null) return <div key={i} />;
            const isOff = absenceDays.has(dayKey(new Date(Date.UTC(viewMonth.y, viewMonth.m, c))));
            return (
              <div key={i} className={`grid h-7 place-items-center rounded text-xs tabular-nums ${isOff ? "bg-red-500 text-white font-semibold" : "text-ink"}`}>{c}</div>
            );
          })}
        </div>
      </div>

      {/* Logger form */}
      {open ? (
        <div className="mb-4 rounded-xl border border-line p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-ink">{editId ? "Edit call-out" : `Log a call-out — ${employeeName.split(" ")[0]}`}</div>
            <button onClick={() => { setOpen(false); resetForm(); }} className="text-xs text-muted hover:text-red-600">Cancel</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">First day out
              <DateInput className="mt-1" value={start} onChange={(v) => { setStart(v); if (v > end) setEnd(v); }} />
            </label>
            <label className="block text-sm font-medium">Last day out
              <DateInput className="mt-1" value={end} onChange={setEnd} min={start} />
            </label>
          </div>
          <label className="block text-sm font-medium">Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              <option value="">— Select reason —</option>
              {REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </label>

          {isOther ? (
            <label className="block text-sm font-medium">Detail (required)
              <input value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="Briefly describe the reason" />
            </label>
          ) : (
            <label className="block text-sm font-medium">Note (optional)
              <input value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" placeholder="Optional context (no medical details)" />
            </label>
          )}

          {isInjury ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 text-sm font-medium text-amber-900">Is this related to a workplace accident?</div>
                <div className="flex gap-1 rounded-xl bg-white p-1">
                  <button type="button" onClick={() => setWorkplaceRelated("yes")} className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${workplaceRelated === "yes" ? "bg-emerald-grad text-[#05271c] shadow" : "text-slate-600 hover:text-slate-900"}`}>Yes</button>
                  <button type="button" onClick={() => setWorkplaceRelated("no")} className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${workplaceRelated === "no" ? "bg-red-500 text-white shadow" : "text-slate-600 hover:text-slate-900"}`}>No</button>
                </div>
              </div>
              {workplaceRelated === "yes" ? (
                accidents.length > 0 ? (
                  <label className="block text-sm font-medium text-amber-900">Link the accident report
                    <select value={accidentRecordId} onChange={(e) => setAccidentRecordId(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-white">
                      <option value="">— Select accident report —</option>
                      {accidents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  </label>
                ) : (
                  <p className="text-xs text-amber-800">
                    No accident report yet — <a href={`/my-branch/team/${employeeId}`} className="font-medium underline">create one</a> on the team profile, then link it here.
                  </p>
                )
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <button onClick={() => { setOpen(false); resetForm(); }} className={btn.secondary}>Cancel</button>
            <button onClick={submit} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : editId ? "Save changes" : "Log call-out"}</button>
          </div>
        </div>
      ) : null}

      {msg ? <p className="mb-3 text-sm text-brand-700">{msg}</p> : null}

      {/* History */}
      {absences.length === 0 ? (
        <p className="text-sm text-muted">No call-outs on file.</p>
      ) : (
        <ul className="divide-y divide-line">
          {absences.map((a) => (
            <li key={a.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{a.days > 1 ? `${fmt(a.startDate)} – ${fmt(a.endDate)}` : fmt(a.startDate)}</span>
                <span className="text-xs text-muted">· {a.days} day{a.days === 1 ? "" : "s"}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{reasonLabel(a.reason)}</span>
                {a.reason === "physical_injury" && a.workplaceRelated ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">workplace injury</span> : null}
                {a.noteRequired ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${NOTE_STYLE[a.noteStatus] ?? NOTE_STYLE.none}`}>{NOTE_LABEL[a.noteStatus] ?? a.noteStatus}</span> : null}
                {canManage ? <button onClick={() => beginEdit(a)} className="ml-auto text-[11px] font-medium text-brand-700 hover:underline">Edit</button> : null}
              </div>
              {a.reasonDetail ? <div className="mt-0.5 text-xs text-muted">{a.reasonDetail}</div> : null}
              <div className="mt-0.5 text-[11px] text-muted">
                {a.loggedByName ? `Logged by ${a.loggedByName}` : "Logged"}
                {a.noteStatus === "received" || a.noteStatus === "waived" ? ` · note ${a.noteStatus}${a.noteResolvedBy ? ` by ${a.noteResolvedBy}` : ""}` : ""}
              </div>
              {/* Note-resolution controls — HR/admin only */}
              {a.noteRequired && a.noteStatus === "requested" && canResolve ? (
                <div className="mt-1.5 flex gap-2">
                  <button onClick={() => resolveNote(a.id, "received")} disabled={busy} className="rounded-lg bg-emerald-grad px-3 py-1 text-xs font-medium text-[#05271c] disabled:opacity-50">Mark received</button>
                  <button onClick={() => resolveNote(a.id, "waived")} disabled={busy} className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-ink hover:bg-black/5 disabled:opacity-50">Waive (FMLA/ADA)</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
