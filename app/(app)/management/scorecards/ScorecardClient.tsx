"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { money } from "@/lib/format";

type Row = {
  key: string;
  label: string;
  weight: number;
  type: "auto" | "manual" | "compliance";
  unit: "usd" | "pct" | null;
  actual: number | null;
  budgetTarget: number | null;
  target: string | null;
  met: boolean | null;
  note: string | null;
  suggested: boolean | null;
};

export default function ScorecardClient({
  year, quarter, branch, years, branches, rows, canEdit,
}: {
  year: number;
  quarter: number;
  branch: string;
  years: number[];
  branches: { key: string; label: string }[];
  rows: Row[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, { met: boolean | null; target: string }>>(
    Object.fromEntries(rows.map((r) => [r.key, { met: r.met, target: r.target ?? "" }]))
  );
  const [saving, setSaving] = useState<string | null>(null);

  const earned = rows.reduce((s, r) => s + (state[r.key]?.met === true ? r.weight : 0), 0);
  const scored = rows.filter((r) => state[r.key]?.met != null).length;

  function nav(next: Record<string, string | number>) {
    const p = new URLSearchParams({ year: String(year), quarter: String(quarter), branch, ...Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])) });
    router.push(`/management/scorecards?${p.toString()}`);
  }

  async function save(metricKey: string, patch: { met?: boolean | null; target?: string }) {
    if (!canEdit) return;
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

  const fmt = (v: number | null, unit: string | null) =>
    v == null ? "—" : unit === "pct" ? `${v.toFixed(1)}%` : money(v);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Selector label="Year" value={year} options={years.map((y) => ({ v: y, l: String(y) }))} onChange={(v) => nav({ year: v })} />
        <Selector label="Quarter" value={quarter} options={[1, 2, 3, 4].map((q) => ({ v: q, l: `Q${q}` }))} onChange={(v) => nav({ quarter: v })} />
        <Selector label="Branch" value={branch} options={branches.map((b) => ({ v: b.key, l: b.label }))} onChange={(v) => nav({ branch: v })} />
        {/* Composite score */}
        <div className="ml-auto text-right">
          <div className="text-xs uppercase tracking-wider text-mint">Composite score</div>
          <div className="text-3xl font-light tabular-nums text-white">{earned}%</div>
          <div className="text-[11px] text-mint">{scored} of {rows.length} metrics scored</div>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
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
                        {r.type === "auto" ? "Auto from reports" : r.type === "compliance" ? "Compliance · Y/N" : "Manual"}
                        {r.suggested != null ? ` · suggested: ${r.suggested ? "Met" : "Not Met"}` : ""}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted">{r.weight}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.type === "auto" ? fmt(r.actual, r.unit) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        defaultValue={st.target || (r.budgetTarget != null ? fmt(r.budgetTarget, r.unit) : "")}
                        placeholder={r.type === "auto" && r.budgetTarget != null ? `budget ${fmt(r.budgetTarget, r.unit)}` : "TBD"}
                        disabled={!canEdit}
                        onBlur={(e) => e.target.value !== (st.target || "") && save(r.key, { target: e.target.value })}
                        className="w-28 rounded-lg border border-line px-2 py-1 text-sm text-ink disabled:opacity-60"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-center gap-1">
                        <MetButton active={st.met === true} tone="met" disabled={!canEdit} onClick={() => save(r.key, { met: st.met === true ? null : true })}>Met</MetButton>
                        <MetButton active={st.met === false} tone="not" disabled={!canEdit} onClick={() => save(r.key, { met: st.met === false ? null : false })}>Not</MetButton>
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
                <td className="px-3 py-2 text-right text-muted text-xs">Earned</td>
                <td className="px-4 py-2 text-center tabular-nums">{earned}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-muted">
        Five metrics pull actuals from the Monthly Board Report; the reviewer confirms Met/Not-Met.
        Compliance items are Y/N. {canEdit ? "Changes save automatically." : "Read-only — admin access required to score."}
        {saving ? " · saving…" : ""}
      </p>

      <Card className="p-4 mt-4">
        <div className="text-sm font-medium text-ink mb-1">Guardrails &amp; gates</div>
        <p className="text-xs text-muted">
          Retention rate, callback/redo rate (guardrails against cost-ratio gaming) and Safety / Licensing gates
          are tracked here once their data sources are wired up. A failed safety or licensing gate should cap the
          bonus regardless of the weighted score.
        </p>
      </Card>
    </>
  );
}

function Selector({ label, value, options, onChange }: { label: string; value: string | number; options: { v: string | number; l: string }[]; onChange: (v: string | number) => void }) {
  return (
    <label className="text-xs font-medium text-mint">
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
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${active ? on : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
    >
      {children}
    </button>
  );
}
