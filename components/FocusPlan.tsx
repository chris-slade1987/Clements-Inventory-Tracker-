"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";
import { money } from "@/lib/format";
import type { FocusItemDTO, FocusType } from "@/lib/sales-focus";

// The structured strategic Focus Plan (goal-sheet Step 3). The advisor documents
// the outreach ACTIONS they'll run this month — cross-sell lists, networking,
// drop-offs, custom — each with a target, a follow-up date, an optional day-before
// reminder, and (once it happens) a logged OUTCOME. The daily cron nudges them to
// log the outcome; logging it notifies the Sales Director. Every action carries an
// inline coaching log the advisor, director and super admins share. Rendered on
// BOTH the advisor view (/me/sales) and the director view (/sales/[id]).

const TYPES: { key: FocusType; label: string; emoji: string; blurb: string }[] = [
  { key: "crosssell", label: "Cross-sell", emoji: "🎯", blurb: "Work a list of existing customers for an added service." },
  { key: "networking", label: "Networking", emoji: "🤝", blurb: "A group or meeting you'll attend to build referrals." },
  { key: "dropoffs", label: "Drop-offs", emoji: "📍", blurb: "Door-hangers / flyers in a target neighborhood." },
  { key: "other", label: "Other", emoji: "✨", blurb: "Any other play you want to run this month." },
];
const TYPE_META: Record<string, { label: string; emoji: string }> = Object.fromEntries(TYPES.map((t) => [t.key, { label: t.label, emoji: t.emoji }]));

const STATUS: Record<string, { label: string; cls: string }> = {
  planned: { label: "Planned", cls: "bg-brand-50 text-brand-700 border-brand-200" },
  nudged: { label: "Follow up now", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  outcome_logged: { label: "Outcome logged", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "Closed", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

const todayKey = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null);
const dayBefore = (ymd: string) => { const d = new Date(`${ymd}T12:00:00.000Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

type Draft = { id?: string; type: FocusType; title: string; plan: string; goalText: string; goalCount: string; followUpAt: string; remindDayBefore: boolean };
const emptyDraft = (type: FocusType): Draft => ({ type, title: "", plan: "", goalText: "", goalCount: "", followUpAt: "", remindDayBefore: false });

export default function FocusPlan({
  periodKey, advisorEmployeeId, items, canEdit, canComment, viewerName, hasLastMonthPlan = false,
}: {
  periodKey: string;
  advisorEmployeeId: string;
  items: FocusItemDTO[];
  canEdit: boolean;
  canComment: boolean;
  viewerName: string;
  hasLastMonthPlan?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/sales/focus", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodKey, advisorEmployeeId, ...payload }),
      });
      const d = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setErr(d.error ?? "Could not save."); return false; }
      router.refresh();
      return true;
    } catch (e) { setBusy(false); setErr((e as Error).message); return false; }
  }

  function startAdd(type: FocusType) { setErr(null); setDraft(emptyDraft(type)); }
  function startEdit(it: FocusItemDTO) {
    setErr(null);
    setDraft({
      id: it.id, type: it.type, title: it.title ?? "", plan: it.plan ?? "", goalText: it.goalText ?? "",
      goalCount: it.goalCount != null ? String(it.goalCount) : "",
      followUpAt: it.followUpAt ? it.followUpAt.slice(0, 10) : "",
      remindDayBefore: !!it.remindAt,
    });
  }

  async function saveDraft() {
    if (!draft) return;
    if (draft.type === "other" && !draft.title.trim() && !draft.plan.trim()) { setErr("Add a title or a plan."); return; }
    const remindAt = draft.type === "networking" && draft.remindDayBefore && draft.followUpAt ? dayBefore(draft.followUpAt) : null;
    const ok = await post({
      action: "upsert",
      id: draft.id ?? null,
      type: draft.type,
      title: draft.title,
      plan: draft.plan,
      goalText: draft.goalText,
      goalCount: draft.goalCount === "" ? null : Number(draft.goalCount),
      followUpAt: draft.followUpAt || null,
      remindAt,
    });
    if (ok) setDraft(null);
  }

  const copyLastMonth = () => post({ action: "copy_last_month" });

  return (
    <div className="space-y-4">
      {canEdit ? (
        <>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => startAdd(t.key)}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-black/[0.02]"
              >
                <span aria-hidden>{t.emoji}</span>
                Add {t.label.toLowerCase()}
              </button>
            ))}
          </div>
          {items.length === 0 && hasLastMonthPlan ? (
            <button type="button" onClick={copyLastMonth} disabled={busy} className="text-xs font-medium text-brand-700 hover:underline">
              ↻ Copy last month&rsquo;s plan
            </button>
          ) : null}
        </>
      ) : null}

      {draft ? <DraftForm draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => { setDraft(null); setErr(null); }} busy={busy} /> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}

      {items.length === 0 && !draft ? (
        <div className="rounded-xl border border-dashed border-line bg-white/50 px-4 py-6 text-center text-sm text-muted">
          {canEdit ? "No focus actions yet. Pick one above — document which list you'll work, which meeting you'll attend, or where you'll drop off, with a follow-up date so we can nudge you." : "No focus plan documented for this month yet."}
        </div>
      ) : null}

      <div className="space-y-3">
        {items.map((it) => (
          <FocusCard
            key={it.id}
            it={it}
            canEdit={canEdit}
            canComment={canComment}
            viewerName={viewerName}
            onEdit={() => startEdit(it)}
            post={post}
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}

function DraftForm({ draft, setDraft, onSave, onCancel, busy }: { draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  const set = (k: keyof Draft, v: string | boolean) => setDraft({ ...draft, [k]: v });
  const meta = TYPE_META[draft.type];
  const dateLabel = draft.type === "networking" ? "Meeting date" : "Follow up on";
  const planLabel =
    draft.type === "crosssell" ? "Which list will you work?"
      : draft.type === "networking" ? "Which meeting / group?"
        : draft.type === "dropoffs" ? "Where? (neighborhood / area)"
          : "What's the plan?";
  const showLeadTarget = draft.type === "crosssell" || draft.type === "dropoffs";

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden>{meta?.emoji}</span>{draft.id ? "Edit" : "New"} {meta?.label.toLowerCase()} action
      </div>
      <div className="grid gap-3">
        {draft.type === "other" ? (
          <Field label="Title">
            <input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Quarterly commercial blitz" className={inputCls} />
          </Field>
        ) : (
          <Field label="Name / label (optional)">
            <input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder={draft.type === "networking" ? "e.g. Tuesday BNI" : draft.type === "crosssell" ? "e.g. Lapsed mosquito customers" : "e.g. Riverside flyers"} className={inputCls} />
          </Field>
        )}
        <Field label={planLabel}>
          <textarea value={draft.plan} onChange={(e) => set("plan", e.target.value)} rows={2} placeholder={draft.type === "crosssell" ? "Which customer list + which service you'll pitch" : draft.type === "dropoffs" ? "Which streets / neighborhood" : draft.type === "networking" ? "Group name + what you want out of it" : "The details"} className={inputCls} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {showLeadTarget ? (
            <Field label="Lead target (#)">
              <input type="number" inputMode="numeric" min={0} value={draft.goalCount} onChange={(e) => set("goalCount", e.target.value)} placeholder="0" className={inputCls} />
            </Field>
          ) : (
            <Field label="Goal">
              <input value={draft.goalText} onChange={(e) => set("goalText", e.target.value)} placeholder={draft.type === "networking" ? "e.g. 2 solid referrals" : "What success looks like"} className={inputCls} />
            </Field>
          )}
          <Field label={dateLabel}>
            <input type="date" value={draft.followUpAt} min={draft.id ? undefined : todayKey()} onChange={(e) => set("followUpAt", e.target.value)} className={inputCls} />
          </Field>
        </div>
        {draft.type === "networking" ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={draft.remindDayBefore} onChange={(e) => set("remindDayBefore", e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Remind me the day before
          </label>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSave} disabled={busy} className={btn.primary}>{busy ? "Saving…" : draft.id ? "Save changes" : "Add to plan"}</button>
        <button type="button" onClick={onCancel} className={btn.secondary}>Cancel</button>
      </div>
    </div>
  );
}

function FocusCard({ it, canEdit, canComment, viewerName, onEdit, post, busy }: {
  it: FocusItemDTO; canEdit: boolean; canComment: boolean; viewerName: string;
  onEdit: () => void; post: (p: Record<string, unknown>) => Promise<boolean>; busy: boolean;
}) {
  const meta = TYPE_META[it.type];
  const st = STATUS[it.status] ?? STATUS.planned;
  const [logOpen, setLogOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [outcome, setOutcome] = useState(it.outcome ?? "");
  const [oLeads, setOLeads] = useState(it.outcomeLeads != null ? String(it.outcomeLeads) : "");
  const [oClosed, setOClosed] = useState(it.outcomeClosed != null ? String(it.outcomeClosed) : "");
  const [showOutcome, setShowOutcome] = useState(false);

  const overdue = !!(it.followUpAt && new Date(it.followUpAt).getTime() <= Date.now() && it.status !== "outcome_logged" && it.status !== "closed");
  const dateStr = fmtDate(it.followUpAt);

  async function submitComment() {
    if (!comment.trim()) return;
    if (await post({ action: "comment", id: it.id, body: comment })) setComment("");
  }
  async function submitOutcome() {
    if (await post({ action: "outcome", id: it.id, outcome, outcomeLeads: oLeads === "" ? null : Number(oLeads), outcomeClosed: oClosed === "" ? null : Number(oClosed) })) setShowOutcome(false);
  }
  const remove = () => { if (confirm("Remove this focus action from your plan?")) post({ action: "void", id: it.id, voided: true }); };

  return (
    <div className={`rounded-xl border bg-white p-4 ${overdue ? "border-amber-300" : "border-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden>{meta?.emoji}</span>
            <span className="text-sm font-semibold text-ink">{it.title?.trim() || meta?.label}</span>
            <span className="text-[11px] text-muted">{meta?.label}</span>
          </div>
          {it.plan ? <p className="mt-1 text-sm text-muted">{it.plan}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {it.goalCount != null ? <span>Target: <span className="font-medium text-ink tabular-nums">{it.goalCount} leads</span></span> : null}
            {it.goalText ? <span>Goal: <span className="font-medium text-ink">{it.goalText}</span></span> : null}
            {dateStr ? <span className={overdue ? "font-medium text-amber-700" : ""}>{overdue ? "Follow-up due" : it.type === "networking" ? "Meeting" : "Follow up"} {dateStr}</span> : null}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
      </div>

      {/* Logged outcome */}
      {it.status === "outcome_logged" ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Outcome</div>
          {it.outcome ? <p className="mt-0.5 text-ink">{it.outcome}</p> : null}
          {(it.outcomeLeads != null || it.outcomeClosed != null) ? (
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-ink">
              {it.outcomeLeads != null ? <span className="font-medium tabular-nums">{it.outcomeLeads} leads</span> : null}
              {it.outcomeClosed != null ? <span className="font-medium tabular-nums">{money(it.outcomeClosed)} closed</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Owner actions */}
      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <button type="button" onClick={() => setShowOutcome((s) => !s)} className="font-medium text-brand-700 hover:underline">
            {it.status === "outcome_logged" ? "Edit outcome" : "Log outcome"}
          </button>
          <button type="button" onClick={onEdit} className="font-medium text-muted hover:text-ink hover:underline">Edit</button>
          <button type="button" onClick={remove} className="font-medium text-muted hover:text-red-600 hover:underline">Remove</button>
        </div>
      ) : null}

      {showOutcome && canEdit ? (
        <div className="mt-3 rounded-lg border border-line bg-black/[0.015] p-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">What came from it?</span>
            <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} placeholder="e.g. 3 inspections booked, one termite bid out" className={inputCls} />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-ink">Leads generated</span>
              <input type="number" inputMode="numeric" min={0} value={oLeads} onChange={(e) => setOLeads(e.target.value)} placeholder="0" className={inputCls} />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-ink">$ closed</span>
              <input type="number" inputMode="decimal" min={0} value={oClosed} onChange={(e) => setOClosed(e.target.value)} placeholder="0" className={inputCls} />
            </label>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={submitOutcome} disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Save outcome"}</button>
            <button type="button" onClick={() => setShowOutcome(false)} className={btn.secondary}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Coaching log */}
      <div className="mt-3 border-t border-line pt-3">
        <button type="button" onClick={() => setLogOpen((o) => !o)} className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink">
          <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${logOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
          Coaching log{it.comments.length ? ` · ${it.comments.length}` : ""}
        </button>
        {logOpen ? (
          <div className="mt-2 space-y-2">
            {it.comments.length === 0 ? (
              <p className="text-xs text-muted">No notes yet. This is the shared log between you and your Sales Director.</p>
            ) : (
              it.comments.map((c) => (
                <div key={c.id} className="rounded-lg border border-line bg-black/[0.015] px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span className="font-medium text-ink">{c.authorName}</span>
                    <span>{new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{c.body}</p>
                </div>
              ))
            )}
            {canComment ? (
              <div className="flex gap-2">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitComment(); } }}
                  placeholder={`Add a note as ${viewerName}…`}
                  className={inputCls}
                />
                <button type="button" onClick={submitComment} disabled={busy || !comment.trim()} className={btn.secondary}>Post</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-line px-3 py-2.5 text-base sm:text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}
