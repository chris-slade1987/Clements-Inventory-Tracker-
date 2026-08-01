"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import type { ReviewForm as FormDef, ReviewItem } from "@/lib/review";

type SigState = {
  reviewerSignedName: string | null;
  reviewerSignedAt: string | null;
  employeeSignedName: string | null;
  employeeSignedAt: string | null;
  hrSignedName: string | null;
  hrSignedAt: string | null;
};

const ACK = {
  reviewer: "I certify that I conducted this review with the employee and that the responses recorded are accurate to the best of my knowledge.",
  employee: "I acknowledge that I participated in this review and that it was discussed with me. My signature indicates receipt and participation, not necessarily agreement.",
  hr: "Reviewed and approved by Human Resources. This review is complete and filed to the employee's personnel record.",
};

export default function ReviewForm({
  reviewId,
  form,
  initialResponses,
  employeeName,
  reviewerName,
  status,
  sig,
  canEdit,
  canSignReviewer,
  canSignEmployee,
  canApproveHr,
  canReset,
}: {
  reviewId: string;
  form: FormDef;
  initialResponses: Record<string, string>;
  employeeName: string;
  reviewerName: string | null;
  status: string;
  sig: SigState;
  canEdit: boolean;
  canSignReviewer: boolean;
  canSignEmployee: boolean;
  canApproveHr: boolean;
  canReset: boolean;
}) {
  const router = useRouter();
  const [r, setR] = useState<Record<string, string>>(initialResponses ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: string, v: string) => { setR((s) => ({ ...s, [key]: v })); setSaved(false); };

  const answered = useMemo(() => {
    const items = form.sections.flatMap((s) => s.items);
    return items.filter((it) => (r[it.key] ?? "").trim()).length;
  }, [r, form]);
  const totalItems = form.sections.flatMap((s) => s.items).length;

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", reviewId, responses: r, overallRating: r.overall_rating ?? null, nextSteps: r.next_steps ?? null }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Save failed."); }
    setSaved(true); router.refresh();
  }

  return (
    <div className="space-y-4 max-w-3xl pb-28">
      {form.sections.map((section) => (
        <div key={section.title} className="space-y-2">
          <div className="flex items-baseline gap-2 pt-1">
            <h3 className="text-sm font-semibold text-ink">{section.title}</h3>
          </div>
          {section.items.map((it) => (
            <ItemRow key={it.key} it={it} value={r[it.key] ?? ""} onChange={(v) => set(it.key, v)} readOnly={!canEdit} />
          ))}
        </div>
      ))}

      {/* Signatures */}
      <Card className="p-4">
        <div className="text-sm font-medium text-ink mb-1">Signatures</div>
        <p className="text-xs text-muted mb-3">Three signatures finalize this review: the reviewer, the employee, then HR approval.</p>
        <div className="space-y-2">
          <SignRow label={`Reviewer${reviewerName ? ` · ${reviewerName}` : ""}`} name={sig.reviewerSignedName} at={sig.reviewerSignedAt}
            canSign={canSignReviewer} canReset={canReset} reviewId={reviewId} role="reviewer" statement={ACK.reviewer} defaultName={reviewerName ?? ""} onDone={() => router.refresh()} />
          <SignRow label={`Employee · ${employeeName}`} name={sig.employeeSignedName} at={sig.employeeSignedAt}
            canSign={canSignEmployee} canReset={canReset} reviewId={reviewId} role="employee" statement={ACK.employee} defaultName={employeeName} onDone={() => router.refresh()} />
          <SignRow label="HR final approval" name={sig.hrSignedName} at={sig.hrSignedAt}
            canSign={canApproveHr} canReset={canReset} locked={!sig.reviewerSignedAt || !sig.employeeSignedAt} lockedHint="Awaiting reviewer & employee signatures"
            reviewId={reviewId} role="hr" statement={ACK.hr} defaultName="" onDone={() => router.refresh()} />
        </div>

        {canReset ? <HrTools reviewId={reviewId} onDone={() => router.refresh()} /> : null}
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {/* Sticky save bar (reviewer/HR while editing) */}
      {canEdit ? (
        <div className="fixed bottom-0 inset-x-0 sm:left-60 border-t border-line bg-surface/95 backdrop-blur px-4 py-3 z-20">
          <div className="max-w-3xl mx-auto flex items-center gap-4">
            <div className="text-sm">
              <div className="font-semibold tabular-nums">{answered}/{totalItems} answered</div>
              <div className="text-xs text-muted capitalize">{status.replace(/_/g, " ")}</div>
            </div>
            <button onClick={save} disabled={busy} className={`${btn.primary} ml-auto`}>{busy ? "Saving…" : saved ? "Saved ✓" : "Save review"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ItemRow({ it, value, onChange, readOnly }: { it: ReviewItem; value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const whoTag = it.who === "employee" ? "Employee" : "Reviewer";
  return (
    <Card className="p-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 text-sm text-ink">
          {it.label}
          <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 align-middle">{whoTag}</span>
          {it.added ? <span className="ml-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 align-middle">added</span> : null}
        </div>
        {(it.type === "yesno" || it.type === "choice") ? (
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {(it.type === "yesno" ? ["Yes", "No"] : it.options ?? []).map((opt) => {
              const sel = value === opt;
              return (
                <button key={opt} type="button" disabled={readOnly} onClick={() => onChange(opt)}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-100 ${sel ? "bg-emerald-grad text-white shadow" : readOnly ? "text-slate-400" : "text-slate-600 hover:text-slate-900"}`}>
                  {opt}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {it.type === "text" ? (
        readOnly
          ? <p className="mt-2 text-sm text-muted whitespace-pre-line">{value || "—"}</p>
          : <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      ) : null}
      {it.type === "textarea" ? (
        readOnly
          ? <p className="mt-2 text-sm text-muted whitespace-pre-line">{value || "—"}</p>
          : <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm" />
      ) : null}
    </Card>
  );
}

function SignRow({
  label, name, at, canSign, canReset, locked, lockedHint, reviewId, role, statement, defaultName, onDone,
}: {
  label: string; name: string | null; at: string | null; canSign: boolean; canReset?: boolean; locked?: boolean; lockedHint?: string;
  reviewId: string; role: string; statement: string; defaultName: string; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [nm, setNm] = useState(defaultName);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sign() {
    if (!nm.trim()) return setError("Type your full name to sign.");
    if (!ack) return setError("Confirm the acknowledgment to sign.");
    setBusy(true); setError(null);
    const res = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", reviewId, role, signerName: nm, agree: true }) });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Sign failed."); }
    setOpen(false); setAck(false); onDone();
  }

  async function reset() {
    if (!confirm(`Reset the ${role} signature? They'll need to sign again.`)) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset_signature", reviewId, role }) });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Reset failed."); }
    onDone();
  }

  return (
    <div className="text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-44 shrink-0 text-muted">{label}</span>
        {name && at ? (
          <span className="flex-1 flex items-center gap-2 text-ink">✅ {name} <span className="text-xs text-muted">· {new Date(at).toLocaleDateString()}</span>
            {canReset ? <button onClick={reset} disabled={busy} className="text-xs font-medium text-red-600 hover:underline">Reset</button> : null}
          </span>
        ) : locked ? (
          <span className="flex-1 text-xs text-muted italic">{lockedHint ?? "Not yet available"}</span>
        ) : canSign ? (
          <button onClick={() => { setOpen(!open); setError(null); }} className="text-xs font-medium text-brand-700 hover:underline">{open ? "Cancel" : "Sign here"}</button>
        ) : (
          <span className="flex-1 text-xs text-muted italic">Awaiting signature</span>
        )}
      </div>
      {open && canSign && !locked ? (
        <div className="mt-1.5 ml-0 sm:ml-44 rounded-lg bg-black/[0.02] p-2 space-y-2">
          <p className="text-[11px] text-muted italic">&ldquo;{statement}&rdquo;</p>
          <input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="Type full name to sign" className="w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
          <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I have read and agree to the statement above.</label>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <button onClick={sign} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? "Signing…" : "Apply signature"}</button>
        </div>
      ) : null}
      {error && !open ? <p className="ml-0 sm:ml-44 mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function HrTools({ reviewId, onDone }: { reviewId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "reopen" | "recreate", confirmMsg: string) {
    if (!confirm(confirmMsg)) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reviewId }) });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Failed."); }
    onDone();
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">HR tools</div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => act("reopen", "Reopen this review for editing? All signatures are cleared but the answers are kept.")} disabled={busy} className="text-xs font-medium text-brand-700 hover:underline">Reopen &amp; clear signatures</button>
        <span className="text-muted">·</span>
        <button onClick={() => act("recreate", "Recreate this review from scratch? All answers AND signatures are cleared — this can't be undone.")} disabled={busy} className="text-xs font-medium text-red-600 hover:underline">Recreate (clear all answers)</button>
      </div>
      <p className="mt-1 text-[11px] text-muted">Reopen keeps the answers and returns the review to editable. Recreate wipes it back to a blank form.</p>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
