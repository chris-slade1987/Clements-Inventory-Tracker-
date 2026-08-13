"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { money } from "@/lib/format";
import ScorecardSignatures, { type SigLite } from "./ScorecardSignatures";

type Row = {
  key: string;
  label: string;
  weight: number;
  type: "auto" | "manual" | "compliance" | "placeholder";
  unit: "usd" | "pct" | "count" | null;
  actual: number | null;
  budgetTarget: number | null;
  target: string | null;
  met: boolean | null;
  note: string | null;
  suggested: boolean | null;
  detail?: string | null;
};

export type ReviewSerialized = {
  status: string;
  managerName: string | null;
  reviewerName: string | null;
  reviewDate: string | null;
  overallNotes: string | null;
  strengths: string | null;
  areas: string | null;
  goals: string | null;
  score: number | null;
  archivedAt: string | null;
  finalizedAt: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  personnelRecordId: string | null;
  signatures: SigLite[];
};

export type ArchivedLite = { year: number; quarter: number; branch: string; branchLabel: string; score: number | null; archivedAt: string | null };

export type SignInfo = {
  signUrl: string | null;
  managerEmail: string | null;
  lastEmail: { status: string; at: string; error: string | null } | null;
};

/** Plain-English label for an EmailLog delivery status. */
function statusLabel(s: string | null | undefined): string {
  switch (s) {
    case "sent": return "sent";
    case "skipped_no_provider": return "no email provider configured";
    case "skipped_no_address": return "no manager email on file";
    case "error": return "provider error";
    default: return s ?? "unknown";
  }
}

const NARRATIVE: { key: "overallNotes" | "strengths" | "areas" | "goals"; label: string }[] = [
  { key: "overallNotes", label: "Overall performance" },
  { key: "strengths", label: "Strengths" },
  { key: "areas", label: "Areas for improvement" },
  { key: "goals", label: "Goals for next quarter" },
];

export default function ScorecardClient({
  year, quarter, branch, branchLabel, years, branches, rows, canEdit, canSign = false, canFinalize = false,
  review, archived: archivedList = [], suggestedManagerName = "", basePath = "/management/scorecards", signInfo = null,
}: {
  year: number;
  quarter: number;
  branch: string;
  branchLabel?: string;
  years: number[];
  branches: { key: string; label: string }[];
  rows: Row[];
  canEdit: boolean;
  canSign?: boolean;
  canFinalize?: boolean;
  review?: ReviewSerialized | null;
  archived?: ArchivedLite[];
  suggestedManagerName?: string;
  basePath?: string;
  signInfo?: SignInfo | null;
}) {
  const router = useRouter();
  const status = review?.status ?? "draft";
  const isArchived = status === "archived";
  const isFinal = status === "final";
  const isDraft = !isArchived && !isFinal;
  // Editing (toggles + comments) is allowed only while a draft. Publishing locks it.
  const editable = canEdit && isDraft;

  const [state, setState] = useState<Record<string, { met: boolean | null; target: string }>>(
    Object.fromEntries(rows.map((r) => [r.key, { met: r.met, target: r.target ?? "" }]))
  );
  const [narrative, setNarrative] = useState({
    managerName: review?.managerName ?? "",
    reviewerName: review?.reviewerName ?? "",
    reviewDate: review?.reviewDate ? review.reviewDate.slice(0, 10) : "",
    overallNotes: review?.overallNotes ?? "",
    strengths: review?.strengths ?? "",
    areas: review?.areas ?? "",
    goals: review?.goals ?? "",
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Reset ALL local edits when the scorecard identity (branch/quarter/year)
  // changes — belt-and-suspenders on top of the per-identity remount key, so one
  // branch's Met/Not toggles and comments can NEVER bleed onto another branch,
  // even if the parent doesn't remount. React's documented "reset state on a
  // prop change" pattern (a set-state during render re-renders immediately).
  const identity = `${year}-${quarter}-${branch}`;
  const [syncedTo, setSyncedTo] = useState(identity);
  if (syncedTo !== identity) {
    setSyncedTo(identity);
    setState(Object.fromEntries(rows.map((r) => [r.key, { met: r.met, target: r.target ?? "" }])));
    setNarrative({
      managerName: review?.managerName ?? "",
      reviewerName: review?.reviewerName ?? "",
      reviewDate: review?.reviewDate ? review.reviewDate.slice(0, 10) : "",
      overallNotes: review?.overallNotes ?? "",
      strengths: review?.strengths ?? "",
      areas: review?.areas ?? "",
      goals: review?.goals ?? "",
    });
  }

  const earned = rows.reduce((s, r) => s + (state[r.key]?.met === true ? r.weight : 0), 0);
  const scored = rows.filter((r) => state[r.key]?.met != null).length;
  const sigs = review?.signatures ?? [];
  const supervisorSig = sigs.find((s) => s.role === "reviewer");
  const managerSig = sigs.find((s) => s.role === "manager");

  // Publish-as-final capture (supervisor's typed signature).
  const [showPublish, setShowPublish] = useState(false);
  const [pubName, setPubName] = useState(suggestedManagerName ? "" : "");
  const [pubTitle, setPubTitle] = useState("Supervisor");
  const [pubAck, setPubAck] = useState(false);
  const [pubResult, setPubResult] = useState<{ emailed: boolean; managerEmail: string | null; signUrl: string } | null>(null);
  // Live result of a Resend (overrides the server-rendered signInfo once used).
  const [resendResult, setResendResult] = useState<{ emailStatus: string; managerEmail: string | null; signUrl: string } | null>(null);

  // The effective published-state delivery info, newest signal first:
  // an in-session resend/publish result, else the server-rendered signInfo.
  const effSignUrl = resendResult?.signUrl || signInfo?.signUrl || pubResult?.signUrl || "";
  const effEmail = resendResult?.managerEmail ?? signInfo?.managerEmail ?? pubResult?.managerEmail ?? null;
  const effStatus: string | null = resendResult?.emailStatus ?? signInfo?.lastEmail?.status ?? (pubResult ? (pubResult.emailed ? "sent" : "error") : null);

  // Re-email the manager the secure sign link (admin; FINAL review).
  async function resend() {
    setSaving("resend"); setBanner(null);
    const res = await fetch("/api/management/scorecard/review", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resend", year, quarter, branch }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(null);
    if (!res.ok) return setBanner(d.error ?? "Could not resend.");
    setResendResult({ emailStatus: d.emailStatus ?? "error", managerEmail: d.managerEmail ?? null, signUrl: d.signUrl ?? "" });
    setBanner(d.emailStatus === "sent"
      ? `Signature email re-sent to ${d.managerEmail}.`
      : `Email not delivered (${statusLabel(d.emailStatus)}). Copy the secure link below and send it to the manager directly.`);
  }

  // Un-publish a FINAL (awaiting-signature) review back to an editable draft.
  async function unpublish() {
    if (!window.confirm("Un-publish this scorecard back to an editable draft?\n\nThis clears the supervisor signature and the manager's signing link so you can correct it and publish again. Nothing has been filed yet — the manager hasn't signed.")) return;
    setSaving("unpublish"); setBanner(null);
    const res = await fetch("/api/management/scorecard/review", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unpublish", year, quarter, branch }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setSaving(null); return setBanner(d.error ?? "Could not un-publish."); }
    router.refresh();
  }

  function nav(next: Record<string, string | number>) {
    const p = new URLSearchParams({ year: String(year), quarter: String(quarter), branch, ...Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])) });
    router.push(`${basePath}?${p.toString()}`);
  }

  async function save(metricKey: string, patch: { met?: boolean | null; target?: string }) {
    if (!editable) return;
    setSaving(metricKey);
    setState((s) => ({ ...s, [metricKey]: { ...s[metricKey], ...patch } as { met: boolean | null; target: string } }));
    try {
      await fetch("/api/management/scorecard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, quarter, branch, metricKey, ...patch }),
      });
    } finally {
      setSaving(null);
    }
  }

  async function saveReview(patch: Record<string, string>) {
    if (!editable) return;
    setSaving("review");
    try {
      await fetch("/api/management/scorecard/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", year, quarter, branch, ...patch }),
      });
    } finally {
      setSaving(null);
    }
  }

  // Publish as final: locks the scorecard, records the supervisor's signature,
  // and emails the manager a secure link to add theirs.
  async function publish() {
    if (!canFinalize) return;
    if (!pubName.trim()) return setBanner("Type the supervisor's full name to sign & publish.");
    if (!pubAck) return setBanner("Confirm the acknowledgment to publish.");
    setSaving("publish"); setBanner(null);
    const res = await fetch("/api/management/scorecard/review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", year, quarter, branch, supervisorName: pubName, supervisorTitle: pubTitle }),
    });
    setSaving(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setBanner(d.error ?? "Could not publish.");
    setShowPublish(false);
    setPubResult({ emailed: !!d.emailed, managerEmail: d.managerEmail ?? null, signUrl: d.signUrl ?? "" });
    router.refresh();
  }

  // Edit an archived scorecard (admin) — behind an explicit confirmation. Clears
  // signatures and returns it to draft; re-publishing notifies all stakeholders.
  async function reopen() {
    if (!canFinalize) return;
    const ok = window.confirm(
      "Are you sure you want to EDIT this archived scorecard?\n\nThis unlocks it for changes and clears both signatures. When you re-publish, every admin and the branch manager will be notified that the published version changed, and the updated copy will overwrite the one on the manager's profile and in the branch hub.",
    );
    if (!ok) return;
    const note = window.prompt("Briefly, what needs to change? (logged on the audit trail)") ?? "";
    setSaving("reopen"); setBanner(null);
    const res = await fetch("/api/management/scorecard/review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen", year, quarter, branch, note }),
    });
    setSaving(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setBanner(d.error ?? "Could not reopen.");
    router.refresh();
  }

  const fmt = (v: number | null, unit: string | null) =>
    v == null ? "—" : unit === "pct" ? `${v.toFixed(1)}%` : unit === "count" ? Math.round(v).toLocaleString() : money(v);

  return (
    <div className="print:text-black">
      <div className="flex flex-wrap items-end gap-3 mb-4 print:hidden">
        <Selector label="Year" value={year} options={years.map((y) => ({ v: y, l: String(y) }))} onChange={(v) => nav({ year: v })} />
        <Selector label="Quarter" value={quarter} options={[1, 2, 3, 4].map((q) => ({ v: q, l: `Q${q}` }))} onChange={(v) => nav({ quarter: v })} />
        <Selector label="Branch" value={branch} options={branches.map((b) => ({ v: b.key, l: b.label }))} onChange={(v) => nav({ branch: v })} />
        <div className="ml-auto flex items-center gap-3">
          <button onClick={() => window.print()} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-black/[0.03]">Print / PDF</button>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-muted">Composite score</div>
            <div className="text-3xl font-light tabular-nums text-ink">{isArchived && review?.score != null ? review.score : earned}%</div>
            <div className="text-[11px] text-muted">{scored} of {rows.length} metrics scored</div>
          </div>
        </div>
      </div>

      {isArchived ? (
        <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="font-semibold">Archived {review?.archivedAt ? new Date(review.archivedAt).toLocaleDateString() : ""}</div>
          <div className="text-emerald-800">
            Final weighted score <strong>{review?.score ?? earned}%</strong>. This review is locked and filed to the manager&rsquo;s personnel record.
            {review?.reopenedAt ? ` · Previously reopened by ${review.reopenedBy ?? "an admin"} on ${new Date(review.reopenedAt).toLocaleDateString()}.` : ""}
          </div>
          {canFinalize ? (
            <button onClick={reopen} disabled={saving === "reopen"} className="print:hidden mt-2 rounded-lg border border-emerald-400 bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">{saving === "reopen" ? "Reopening…" : "Reopen (admin)"}</button>
          ) : null}
        </div>
      ) : null}

      {/* Part 1 — Header */}
      <Card className="p-4 mb-4 break-inside-avoid">
        <div className="text-sm font-medium text-ink mb-3">Manager Performance Review</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <Field label="Manager name">
            {editable ? (
              <input key={`${identity}-managerName`} defaultValue={narrative.managerName} placeholder={suggestedManagerName || "Manager name"}
                onBlur={(e) => { if (e.target.value !== narrative.managerName) { setNarrative((n) => ({ ...n, managerName: e.target.value })); saveReview({ managerName: e.target.value }); } }}
                className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-ink" />
            ) : <div className="text-ink">{narrative.managerName || suggestedManagerName || "—"}</div>}
          </Field>
          <Field label="Review period"><div className="text-ink">Q{quarter} {year}</div></Field>
          <Field label="Branch / region"><div className="text-ink">{branchLabel ?? branch}</div></Field>
          <Field label="Reviewer name(s)">
            {editable ? (
              <input key={`${identity}-reviewerName`} defaultValue={narrative.reviewerName} placeholder="Reviewer name(s)"
                onBlur={(e) => { if (e.target.value !== narrative.reviewerName) { setNarrative((n) => ({ ...n, reviewerName: e.target.value })); saveReview({ reviewerName: e.target.value }); } }}
                className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-ink" />
            ) : <div className="text-ink">{narrative.reviewerName || "—"}</div>}
          </Field>
          <Field label="Review date">
            {editable ? (
              <input key={`${identity}-reviewDate`} type="date" defaultValue={narrative.reviewDate}
                onBlur={(e) => { if (e.target.value !== narrative.reviewDate) { setNarrative((n) => ({ ...n, reviewDate: e.target.value })); saveReview({ reviewDate: e.target.value }); } }}
                className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-ink" />
            ) : <div className="text-ink">{narrative.reviewDate ? new Date(narrative.reviewDate).toLocaleDateString() : "—"}</div>}
          </Field>
        </div>
      </Card>

      {/* Part 2 — Performance Scorecard table */}
      <Card className="p-0 overflow-hidden break-inside-avoid">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Metric</th>
                <th className="px-2 py-2 font-medium text-right">Weight</th>
                <th className="px-3 py-2 font-medium text-right">Actual (reports)</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium text-center">Met?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = state[r.key];
                return (
                  <tr key={r.key} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium text-ink">{r.label}</div>
                      <div className="text-[11px] text-muted">
                        {r.type === "auto" ? "Auto from reports" : r.type === "compliance" ? "Compliance · Y/N" : r.type === "placeholder" ? "Placeholder" : "Manual"}
                        {r.suggested != null ? ` · suggested: ${r.suggested ? "Met" : "Not Met"}` : ""}
                      </div>
                      {r.detail ? <div className="text-[11px] text-brand-600">{r.detail}</div> : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted">{r.weight}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.type === "auto" ? fmt(r.actual, r.unit) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.type === "auto" ? (
                        // Auto targets are the budget itself — pulled straight from the
                        // 2026 Branch KPIs workbook / budget model. Read-only, never typed.
                        <span className="text-ink tabular-nums">{r.budgetTarget != null ? fmt(r.budgetTarget, r.unit) : "—"}</span>
                      ) : editable ? (
                        // Only manual / placeholder lines (e.g. Chemical) are fillable.
                        <input
                          key={`${identity}-${r.key}-target`}
                          defaultValue={st.target || ""}
                          placeholder="TBD"
                          onBlur={(e) => e.target.value !== (st.target || "") && save(r.key, { target: e.target.value })}
                          className="w-28 rounded-lg border border-line px-2 py-1 text-sm text-ink"
                        />
                      ) : (
                        <span className="text-ink">{st.target || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-center gap-1">
                        <MetButton active={st.met === true} tone="met" disabled={!editable} onClick={() => save(r.key, { met: st.met === true ? null : true })}>Met</MetButton>
                        <MetButton active={st.met === false} tone="not" disabled={!editable} onClick={() => save(r.key, { met: st.met === false ? null : false })}>Not</MetButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-2 py-2 text-right tabular-nums">100%</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right text-muted text-xs">Weighted score</td>
                <td className="px-4 py-2 text-center tabular-nums">{isArchived && review?.score != null ? review.score : earned}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-muted print:hidden">
        Auto metrics pull YTD actuals from the Monthly Board Report; the reviewer confirms Met/Not-Met.
        {editable ? " Changes save automatically." : isArchived ? " Archived — read-only." : " Read-only — admin access required to score."}
        {saving && saving !== "finalize" && saving !== "reopen" ? " · saving…" : ""}
      </p>

      {/* Part 3 — Reviewer comments */}
      <Card className="p-4 mt-4 break-inside-avoid">
        <div className="text-sm font-medium text-ink mb-3">Reviewer comments</div>
        <div className="grid gap-4 sm:grid-cols-2">
          {NARRATIVE.map((f) => (
            <div key={f.key}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{f.label}</div>
              {editable ? (
                <textarea
                  key={`${identity}-${f.key}`}
                  defaultValue={narrative[f.key]}
                  rows={4}
                  onBlur={(e) => { if (e.target.value !== narrative[f.key]) { setNarrative((n) => ({ ...n, [f.key]: e.target.value })); saveReview({ [f.key]: e.target.value }); } }}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-ink"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-ink min-h-[1.5rem]">{narrative[f.key] || "—"}</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Part 4 — Signatures (supervisor at publish, manager via email or in-app) */}
      <ScorecardSignatures year={year} quarter={quarter} branch={branch} signatures={sigs} canSign={canSign && !isDraft} locked={isArchived} />

      {banner ? <p className="mt-3 text-xs text-red-600">{banner}</p> : null}

      {/* Lifecycle controls */}
      {canFinalize ? (
        <div className="mt-4 print:hidden">
          {isDraft ? (
            !showPublish ? (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => { setShowPublish(true); setBanner(null); }} className="rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm">Publish as final version</button>
                <span className="text-xs text-muted">Changes save automatically as a draft. Publishing locks the scorecard, records your supervisor signature, and emails the manager to sign.</span>
              </div>
            ) : (
              <div className="max-w-md space-y-2 rounded-xl border border-line p-4">
                <div className="text-sm font-medium text-ink">Publish &amp; sign as supervisor</div>
                <p className="text-[11px] italic text-muted">&ldquo;I certify that I reviewed this manager&rsquo;s quarterly performance, that the scorecard and comments accurately reflect that review, and that I discussed it with the manager.&rdquo;</p>
                <input value={pubName} onChange={(e) => setPubName(e.target.value)} placeholder="Type your full name to sign" className="w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                <input value={pubTitle} onChange={(e) => setPubTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                <label className="flex items-start gap-2 text-[11px] text-ink"><input type="checkbox" checked={pubAck} onChange={(e) => setPubAck(e.target.checked)} className="mt-0.5" />I have read and agree to the statement above.</label>
                <div className="flex gap-2">
                  <button onClick={publish} disabled={saving === "publish"} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving === "publish" ? "Publishing…" : "Publish & email manager"}</button>
                  <button onClick={() => { setShowPublish(false); setBanner(null); }} className="rounded-lg px-2 py-1 text-xs text-muted hover:underline">Cancel</button>
                </div>
              </div>
            )
          ) : isFinal ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-medium text-amber-900">Published — awaiting the manager&rsquo;s signature</div>
              <p className="mt-1 text-xs text-amber-800">
                The supervisor{supervisorSig ? ` (${supervisorSig.typedName})` : ""} has signed.{" "}
                {managerSig ? "The manager has signed — completing." : "The manager gets a secure link to review and sign; it completes automatically once they sign. A signed-in manager can also sign above."}
              </p>

              {canFinalize && !managerSig ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 p-3 space-y-2 print:hidden">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-amber-900">Manager email:</span>
                    <span className="font-medium text-ink">{effEmail || "— none on file —"}</span>
                    {effStatus ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${effStatus === "sent" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                        Last email: {statusLabel(effStatus)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">No send recorded</span>
                    )}
                  </div>
                  {effStatus && effStatus !== "sent" ? (
                    <p className="text-[11px] text-red-700">
                      {effStatus === "skipped_no_provider"
                        ? "No email provider is configured (RESEND_API_KEY), so nothing was sent. Configure it, or copy the secure link below and send it to the manager directly."
                        : effStatus === "skipped_no_address"
                        ? "No email address is on file for this branch manager. Add one to their profile, or copy the secure link below and send it directly."
                        : "The email provider returned an error. Copy the secure link below and send it directly, then check the Email delivery log."}
                    </p>
                  ) : null}
                  {effSignUrl ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input readOnly value={effSignUrl} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border border-line bg-white px-2 py-1 text-[11px] text-ink" />
                      <button type="button" onClick={() => { navigator.clipboard?.writeText(effSignUrl); setBanner("Secure sign link copied to clipboard."); }} className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink hover:border-brand-300">Copy link</button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button type="button" onClick={resend} disabled={saving === "resend"} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{saving === "resend" ? "Sending…" : "Resend signature email"}</button>
                    <button type="button" onClick={unpublish} disabled={saving === "unpublish"} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-red-300 disabled:opacity-50">{saving === "unpublish" ? "Un-publishing…" : "Un-publish to edit"}</button>
                    <a href="/management/email-log" className="text-[11px] text-brand-700 hover:underline">Email delivery log →</a>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted">Completed &amp; archived{review?.score != null ? ` · score ${review.score}%` : ""}. Filed to the manager&rsquo;s profile and the branch hub.</span>
              <button onClick={reopen} disabled={saving === "reopen"} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-red-300">{saving === "reopen" ? "Reopening…" : "Edit archived form"}</button>
            </div>
          )}
        </div>
      ) : isArchived ? (
        <p className="mt-4 text-xs text-muted print:hidden">Completed &amp; archived{review?.score != null ? ` · score ${review.score}%` : ""}. Read-only.</p>
      ) : null}

      {/* Archived scorecards list */}
      {archivedList.length ? (
        <Card className="p-4 mt-6 print:hidden">
          <div className="text-sm font-medium text-ink mb-2">Archived scorecards</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="py-1.5 pr-3 font-medium">Period</th>
                  <th className="py-1.5 pr-3 font-medium">Branch</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Score</th>
                  <th className="py-1.5 pr-3 font-medium">Archived</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {archivedList.map((a) => (
                  <tr key={`${a.year}-${a.quarter}-${a.branch}`} className="border-b border-line last:border-0">
                    <td className="py-1.5 pr-3 text-ink">Q{a.quarter} {a.year}</td>
                    <td className="py-1.5 pr-3 text-ink">{a.branchLabel}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{a.score != null ? `${a.score}%` : "—"}</td>
                    <td className="py-1.5 pr-3 text-muted">{a.archivedAt ? new Date(a.archivedAt).toLocaleDateString() : "—"}</td>
                    <td className="py-1.5">
                      <button onClick={() => nav({ year: a.year, quarter: a.quarter, branch: a.branch })} className="text-xs font-medium text-brand-700 hover:underline">Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{label}</div>
      {children}
    </label>
  );
}

function Selector({ label, value, options, onChange }: { label: string; value: string | number; options: { v: string | number; l: string }[]; onChange: (v: string | number) => void }) {
  return (
    <label className="text-xs font-medium text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block rounded-lg border border-line px-3 py-1.5 text-sm bg-surface text-ink"
      >
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

function MetButton({ active, tone, disabled, onClick, children }: { active: boolean; tone: "met" | "not"; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  const on = tone === "met" ? "bg-emerald-600 text-white" : "bg-red-500 text-white";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${active ? on : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
    >
      {children}
    </button>
  );
}
