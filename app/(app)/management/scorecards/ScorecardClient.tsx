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

const NARRATIVE: { key: "overallNotes" | "strengths" | "areas" | "goals"; label: string }[] = [
  { key: "overallNotes", label: "Overall performance" },
  { key: "strengths", label: "Strengths" },
  { key: "areas", label: "Areas for improvement" },
  { key: "goals", label: "Goals for next quarter" },
];

export default function ScorecardClient({
  year, quarter, branch, branchLabel, years, branches, rows, canEdit, canSign = false, canFinalize = false,
  review, archived: archivedList = [], suggestedManagerName = "", basePath = "/management/scorecards",
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
}) {
  const router = useRouter();
  const isArchived = review?.status === "archived";
  const editable = canEdit && !isArchived;

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

  const earned = rows.reduce((s, r) => s + (state[r.key]?.met === true ? r.weight : 0), 0);
  const scored = rows.filter((r) => state[r.key]?.met != null).length;
  const sigs = review?.signatures ?? [];
  const reviewerCount = sigs.filter((s) => s.role === "reviewer").length;
  const managerCount = sigs.filter((s) => s.role === "manager").length;
  const readyToFinalize = reviewerCount >= 2 && managerCount >= 1;

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

  async function finalize() {
    if (!canFinalize || !readyToFinalize) return;
    setSaving("finalize"); setBanner(null);
    const res = await fetch("/api/management/scorecard/review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finalize", year, quarter, branch }),
    });
    setSaving(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setBanner(d.error ?? "Could not finalize.");
    router.refresh();
  }

  async function reopen() {
    if (!canFinalize) return;
    const note = window.prompt("Reason for reopening this archived review? (logged)") ?? "";
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
              <input defaultValue={narrative.managerName} placeholder={suggestedManagerName || "Manager name"}
                onBlur={(e) => { if (e.target.value !== narrative.managerName) { setNarrative((n) => ({ ...n, managerName: e.target.value })); saveReview({ managerName: e.target.value }); } }}
                className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-ink" />
            ) : <div className="text-ink">{narrative.managerName || suggestedManagerName || "—"}</div>}
          </Field>
          <Field label="Review period"><div className="text-ink">Q{quarter} {year}</div></Field>
          <Field label="Branch / region"><div className="text-ink">{branchLabel ?? branch}</div></Field>
          <Field label="Reviewer name(s)">
            {editable ? (
              <input defaultValue={narrative.reviewerName} placeholder="Reviewer name(s)"
                onBlur={(e) => { if (e.target.value !== narrative.reviewerName) { setNarrative((n) => ({ ...n, reviewerName: e.target.value })); saveReview({ reviewerName: e.target.value }); } }}
                className="w-full rounded-lg border border-line px-2 py-1.5 text-sm text-ink" />
            ) : <div className="text-ink">{narrative.reviewerName || "—"}</div>}
          </Field>
          <Field label="Review date">
            {editable ? (
              <input type="date" defaultValue={narrative.reviewDate}
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

      {/* Part 4 — Signatures */}
      <ScorecardSignatures year={year} quarter={quarter} branch={branch} signatures={sigs} canSign={canSign} locked={isArchived} />

      {banner ? <p className="mt-3 text-xs text-red-600">{banner}</p> : null}

      {canFinalize && !isArchived ? (
        <div className="mt-4 flex items-center gap-3 print:hidden">
          <button onClick={finalize} disabled={!readyToFinalize || saving === "finalize"} className="rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50">
            {saving === "finalize" ? "Finalizing…" : "Finalize & archive"}
          </button>
          <span className="text-xs text-muted">{readyToFinalize ? "Locks the review, computes the score, and files it to the manager's personnel record." : `Needs all three signatures (${reviewerCount}/2 reviewers, ${managerCount}/1 manager).`}</span>
        </div>
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
