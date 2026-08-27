"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { money, qty } from "@/lib/format";
import { deriveRates, buildPlan, type GoalSheetInput } from "@/lib/sales-goal";

// A friendly, plain-language rebuild of the Sales Director's Excel goal sheet.
// Two steps — last month's results, then this month's goal — and a live
// "game plan" that shows exactly how many leads/proposals/day it takes.

const pct = (r: number) => `${Math.round((r || 0) * 100)}%`;

type Field = { key: keyof GoalSheetInput; label: string; help: string; kind: "count" | "money" };

const RECAP_FIELDS: Field[] = [
  { key: "reis", label: "Real-estate re-inspections (ReIs)", help: "Homes you inspected for a real-estate sale.", kind: "count" },
  { key: "appts", label: "Appointments", help: "Other sales appointments you ran.", kind: "count" },
  { key: "proposals", label: "Proposals given", help: "How many quotes/proposals you presented.", kind: "count" },
  { key: "pcExposed", label: "Pest-control $ proposed", help: "Total pest-control dollars you quoted.", kind: "money" },
  { key: "pcSold", label: "Pest-control $ sold", help: "Pest-control dollars that closed.", kind: "money" },
  { key: "totalExposure", label: "Total $ proposed (pest + termite)", help: "Every dollar you quoted last month.", kind: "money" },
  { key: "tcSold", label: "Termite $ sold", help: "Termite dollars that closed.", kind: "money" },
  { key: "tcUnits", label: "Termite jobs sold", help: "Number of termite jobs closed (a count).", kind: "count" },
];

export default function GoalPlanner({
  periodKey, periodLabelText, advisorEmployeeId, advisorName, initial, canEdit,
}: {
  periodKey: string;
  periodLabelText: string;
  advisorEmployeeId?: string;
  advisorName?: string;
  initial: GoalSheetInput;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<GoalSheetInput>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const set = (k: keyof GoalSheetInput, val: string) => setV((s) => ({ ...s, [k]: val === "" ? 0 : Number(val) }));

  const { rates, plan } = useMemo(() => {
    const r = deriveRates(v);
    return { rates: r, plan: buildPlan(r, { salesGoal: v.salesGoal, workdays: v.workdays }) };
  }, [v]);

  const ready = v.salesGoal > 0 && v.workdays > 0 && rates.tcClosingPct > 0 && rates.exposurePerProposal > 0 && rates.proposalsPerProspect > 0;
  // A gentle reality check, mirroring the sheet's intent.
  const stretch = ready && plan.prospectsPerDay > 8;

  async function save() {
    setBusy(true); setMsg(null); setErr(false);
    try {
      const res = await fetch("/api/sales/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, periodKey, ...(advisorEmployeeId ? { advisorEmployeeId } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setErr(true); setMsg(d.error ?? "Could not save."); return; }
      setMsg("Saved.");
      router.refresh();
    } catch (e) { setBusy(false); setErr(true); setMsg((e as Error).message); }
  }

  const numInput = (k: keyof GoalSheetInput, kind: "count" | "money") => (
    <div className="relative">
      {kind === "money" ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span> : null}
      <input
        type="number" inputMode={kind === "money" ? "decimal" : "numeric"} min={0}
        disabled={!canEdit}
        value={v[k] === 0 ? "" : String(v[k])}
        onChange={(e) => set(k, e.target.value)}
        placeholder="0"
        className={`w-full rounded-lg border border-line py-2 text-sm ${kind === "money" ? "pl-7 pr-3" : "px-3"} disabled:bg-slate-50`}
      />
    </div>
  );

  return (
    <div className="space-y-5 max-w-4xl pb-10">
      {advisorName ? <p className="text-sm text-muted">Goal sheet for <span className="font-medium text-ink">{advisorName}</span> · {periodLabelText}</p> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* STEP 1 */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">1</span>
            <h2 className="text-base font-semibold text-ink">Last month&apos;s results</h2>
          </div>
          <p className="text-xs text-muted mb-4">Enter what actually happened last month. We use it to learn your personal numbers — no guessing.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {RECAP_FIELDS.map((f) => (
              <label key={f.key} className="block text-sm">
                <span className="font-medium text-ink">{f.label}</span>
                {numInput(f.key, f.kind)}
                <span className="mt-0.5 block text-[11px] text-muted">{f.help}</span>
              </label>
            ))}
          </div>
        </Card>

        {/* STEP 2 */}
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">2</span>
              <h2 className="text-base font-semibold text-ink">This month&apos;s goal</h2>
            </div>
            <p className="text-xs text-muted mb-4">What are you going for this month, and how many days will you work?</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-ink">Sales goal this month</span>
                {numInput("salesGoal", "money")}
                <span className="mt-0.5 block text-[11px] text-muted">e.g. $50,000</span>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-ink">Workdays this month</span>
                {numInput("workdays", "count")}
                <span className="mt-0.5 block text-[11px] text-muted">e.g. 20</span>
              </label>
            </div>
          </Card>

          {/* Your numbers (derived) */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-ink mb-3">Your numbers (from last month)</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Stat label="Avg termite job" value={money(rates.avgTcJobPrice)} />
              <Stat label="Termite close rate" value={pct(rates.tcClosingPct)} />
              <Stat label="Total close rate" value={pct(rates.totalClosingPct)} />
              <Stat label="Proposals per lead" value={qty(rates.proposalsPerProspect)} />
            </dl>
            <p className="mt-3 text-[11px] text-muted">These come straight from last month&apos;s results — the more accurate that is, the better your plan.</p>
          </Card>
        </div>
      </div>

      {/* GAME PLAN */}
      <Card className={`p-5 ${ready ? "ring-1 ring-brand-300 bg-brand-50/40" : ""}`}>
        <h2 className="text-base font-semibold text-ink mb-1">Your game plan</h2>
        {!ready ? (
          <p className="text-sm text-muted">Fill in last month&apos;s results and this month&apos;s goal above, and your daily plan appears here.</p>
        ) : (
          <>
            <p className="text-sm text-ink mb-4">To hit <span className="font-semibold">{money(v.salesGoal)}</span> in <span className="font-semibold">{v.workdays}</span> workdays, here&apos;s your daily target:</p>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Big label="Sales / day" value={money(plan.salesPerDay)} />
              <Big label="Proposals / day" value={qty(plan.proposalsPerDay)} sub={`${qty(plan.totalProposals)} this month`} />
              <Big label="Leads / day" value={qty(plan.prospectsPerDay)} sub={`${qty(plan.prospectsNeeded)} this month`} />
              <Big label="$ proposed / day" value={money(plan.exposurePerDay)} sub={`${money(plan.exposureDollarsNeeded)} this month`} />
            </div>
            {stretch ? (
              <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                <strong>Reality check:</strong> {qty(plan.prospectsPerDay)} leads a day is a heavy load. Either raise your average job value by cross-selling more services, lift your close rate, or adjust the goal so the plan is realistic.
              </p>
            ) : null}
          </>
        )}
      </Card>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className={`${btn.primary}`}>{busy ? "Saving…" : "Save goal sheet"}</button>
          {msg ? <span className={`text-sm ${err ? "text-red-600" : "text-brand-700"}`}>{msg}</span> : null}
        </div>
      ) : (
        <p className="text-xs text-muted">Read-only view.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (<><dt className="text-muted">{label}</dt><dd className="text-right font-medium text-ink tabular-nums">{value}</dd></>);
}

function Big({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
