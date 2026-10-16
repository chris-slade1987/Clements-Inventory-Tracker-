"use client";

// Branch & Company KPIs — the single most important analytics surface on the
// portal. A cohesive, interactive budget-vs-actual-vs-forecast dashboard driven
// entirely by real MBR figures (KpiValue), the branch budget model, real per-
// branch fuel, and line-of-business revenue. Every number comes from the server
// (serializable props) so Prisma stays server-only. Period/basis (Month · YTD ·
// Full-Year Forecast) is URL-driven by the shared Controls; section tabs are
// client state. Brand-compliant: forest chrome + light canvas, thin line icons,
// the COO-approved Signal ramp for status, no emoji. Mobile-first.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { money } from "@/lib/format";
import { Gauge } from "@/components/motivation";
import { BudgetVsForecast, Donut, DivergingBars } from "@/components/charts";

// ---- Types (mirror the server payload — all serializable) -----------------
export type DCell = { actual: number | null; budget: number | null };
export type DSeries = { month: DCell; ytd: DCell; fy: DCell };
export type DBasis = "month" | "ytd" | "fy";

export type DMetric = {
  key: string;
  label: string;
  group: "rev" | "profit" | "cost";
  unit: "usd" | "pct" | "count";
  higherIsBetter: boolean;
  companyWide: boolean;
  pctOfRev: boolean;
  revDenom: "branch" | "company" | null;
  series: DSeries;
  sub?: { label: string; unit: "pct"; series: DSeries } | null;
};

export type MonthlyPt = { label: string; actual: number | null; target: number | null };
export type MonthlyChart = { key: string; label: string; unit: "usd" | "count"; points: MonthlyPt[] };
export type BranchCard = { key: string; label: string; actual: number | null; budget: number | null };
export type FunnelSummary = { leads: number; proposals: number; deals: number; closed: number; goal: number } | null;

export type DashboardPayload = {
  scopeKey: string;
  scopeLabel: string;
  isCompany: boolean;
  locked: boolean;
  basis: DBasis;
  periodLabel: string;
  ytdLabel: string;
  revenue: { label: string; series: DSeries; companyWide: boolean };
  metrics: DMetric[];
  revBranch: DSeries;
  revCompany: DSeries;
  monthly: MonthlyChart[];
  book: { salesMonthly: { label: string; value: number }[]; cancelsMonthly: { label: string; value: number }[]; salesYtd: number | null; cancelsYtd: number | null; companyWide: boolean; scopeLabel: string };
  lob: { label: string; value: number }[];
  perBranch: BranchCard[] | null;
  funnel: FunnelSummary;
};

// ---- Palette (on the always-light content cards) --------------------------
const FAV = "#1f7a45";
const UNFAV = "#c42a2f";
const SAGE = "#74a96e";
const INK = "#1d2a23";
const MUTED = "#5c6b62";
const MIST = "#dce9df";

// ---- Formatting -----------------------------------------------------------
const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const moneyK = (n: number) => (Math.abs(n) >= 1_000_000 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`);

function fmt(v: number | null, unit: DMetric["unit"]): string {
  if (v == null) return "—";
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit === "count") return num(v);
  return money(v);
}

const cellFor = (s: DSeries, b: DBasis): DCell => s[b];

function variance(c: DCell, higherIsBetter: boolean) {
  if (c.actual == null || c.budget == null) return { v: null as number | null, favorable: null as boolean | null };
  const v = c.actual - c.budget;
  return { v, favorable: higherIsBetter ? v >= 0 : v <= 0 };
}

function varText(v: number | null, unit: DMetric["unit"], budget: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "-";
  const mag = Math.abs(v);
  const abs = unit === "pct" ? `${sign}${mag.toFixed(1)} pts` : unit === "count" ? `${sign}${num(mag)}` : `${sign}${money(mag)}`;
  const pct = budget && budget !== 0 ? ` · ${v / budget >= 0 ? "+" : ""}${((v / budget) * 100).toFixed(1)}%` : "";
  return abs + pct;
}

type Tab = "overview" | "revenue" | "expenses" | "forecast";

// ===========================================================================
export default function BranchDashboard({ payload }: { payload: DashboardPayload }) {
  const [tab, setTab] = useState<Tab>("overview");
  const basis = payload.basis;
  const periodWord = basis === "fy" ? "Full-Year Forecast" : basis === "ytd" ? payload.ytdLabel : payload.periodLabel;

  const rev = payload.metrics.filter((m) => m.group === "rev");
  const profit = payload.metrics.filter((m) => m.group === "profit");
  const cost = payload.metrics.filter((m) => m.group === "cost");

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "revenue", label: "Revenue" },
    { key: "expenses", label: "Expenses" },
    { key: "forecast", label: "Forecast" },
  ];

  return (
    <div>
      {/* Context ribbon + section tabs */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-brand-50 px-3 py-1 text-[11px] text-muted">
          <Dot /> {payload.isCompany ? "All branches" : payload.scopeLabel} · showing <b className="font-medium text-ink">{periodWord}</b>
        </div>
        <div role="tablist" aria-label="Dashboard sections" className="inline-flex flex-wrap rounded-xl border border-line bg-brand-50 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${tab === t.key ? "bg-emerald-grad text-white shadow" : "text-muted hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Headline band — always visible */}
      <Headline payload={payload} />

      {tab === "overview" && (
        <>
          {[...rev, ...profit].length > 0 ? (
            <Section title="Performance" hint={`revenue & profitability · ${periodWord}`}>
              <TileGrid>{[...rev, ...profit].map((m) => <Tile key={m.key} m={m} basis={basis} payload={payload} />)}</TileGrid>
            </Section>
          ) : null}
          {cost.length > 0 ? (
            <Section title="Cost lines" hint="lower is better · $ and % of revenue">
              <TileGrid>{cost.map((m) => <Tile key={m.key} m={m} basis={basis} payload={payload} />)}</TileGrid>
            </Section>
          ) : null}
          {payload.isCompany && payload.perBranch ? <PerBranch cards={payload.perBranch} /> : null}
          {payload.lob.length > 0 ? (
            <Section title="Revenue by line of business" hint={payload.periodLabel}>
              <Card className="p-4">
                <Donut
                  slices={payload.lob}
                  centerLabel="total"
                  centerValue={moneyK(payload.lob.reduce((s, r) => s + r.value, 0))}
                />
              </Card>
            </Section>
          ) : null}
          {payload.funnel ? <FunnelPanel f={payload.funnel} scopeLabel={payload.scopeLabel} /> : null}
        </>
      )}

      {tab === "revenue" && (
        <>
          <Section title="Revenue drivers" hint={`budget vs actual · ${periodWord}`}>
            <TileGrid>{[...rev, ...profit].map((m) => <Tile key={m.key} m={m} basis={basis} payload={payload} />)}</TileGrid>
          </Section>
          {payload.monthly.length > 0 ? (
            <Section title="Monthly budget vs actual" hint="solid = posted actuals · dashed = budget ahead · line marks the latest posted month">
              <div className="grid gap-4 lg:grid-cols-3">
                {payload.monthly.map((c) => (
                  <Card key={c.key} className="p-4">
                    <h3 className="text-sm font-medium text-ink">{c.label}</h3>
                    <div className="mt-2"><BudgetVsForecast points={c.points} /></div>
                  </Card>
                ))}
              </div>
            </Section>
          ) : null}
          <BookGrowth book={payload.book} />
          {payload.lob.length > 0 ? (
            <Section title="Revenue by line of business" hint={payload.periodLabel}>
              <Card className="p-4">
                <Donut slices={payload.lob} centerLabel="total" centerValue={moneyK(payload.lob.reduce((s, r) => s + r.value, 0))} />
              </Card>
            </Section>
          ) : null}
        </>
      )}

      {tab === "expenses" && (
        <>
          {cost.length > 0 ? (
            <Section title="Cost lines" hint={`lower is better · ${periodWord}`}>
              <TileGrid>{cost.map((m) => <Tile key={m.key} m={m} basis={basis} payload={payload} />)}</TileGrid>
            </Section>
          ) : (
            <Empty>No cost lines are available for this scope. Company-wide cost detail appears for the all-branches view.</Empty>
          )}
          <ExpenseMix cost={cost} basis={basis} payload={payload} />
          <CostRatio cost={cost} basis={basis} payload={payload} />
          <YtdVariance metrics={payload.metrics} />
        </>
      )}

      {tab === "forecast" && (
        <>
          <ForecastWall metrics={payload.metrics} />
          <PaceSection metrics={payload.metrics} />
          <BookGrowth book={payload.book} />
        </>
      )}

      <p className="mt-6 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
        <b className="text-ink">How to read:</b> green = favorable (revenue ≥ budget, or cost ≤ budget); red = off. Figures follow the
        period toggle (Month · YTD · Full-Year Forecast). Lines tagged <b className="text-ink">company-wide</b> have no branch-level
        split in the loaded model, so the company figure is shown. Charts never fabricate future months — only posted actuals are drawn solid.
      </p>
    </div>
  );
}

// ---- Headline band --------------------------------------------------------
function Headline({ payload }: { payload: DashboardPayload }) {
  const basis = payload.basis;
  const c = cellFor(payload.revenue.series, basis);
  const { v, favorable } = variance(c, true);
  const pct = c.budget && c.budget > 0 && c.actual != null ? Math.round((c.actual / c.budget) * 100) : null;

  // Top movers for the current basis: biggest favorable + biggest unfavorable $.
  const movers = useMemo(() => {
    const scored = payload.metrics
      .map((m) => {
        if (m.unit !== "usd") return null;
        const mc = cellFor(m.series, basis);
        const { v: mv, favorable: fav } = variance(mc, m.higherIsBetter);
        if (mv == null) return null;
        // Favorable impact is positive for good, negative for bad (direction-aware).
        const impact = m.higherIsBetter ? mc.actual! - mc.budget! : mc.budget! - mc.actual!;
        return { label: m.label, companyWide: m.companyWide, impact, favorable: fav === true };
      })
      .filter((x): x is { label: string; companyWide: boolean; impact: number; favorable: boolean } => x != null);
    const best = [...scored].sort((a, b) => b.impact - a.impact)[0];
    const worst = [...scored].sort((a, b) => a.impact - b.impact)[0];
    const out: { label: string; companyWide: boolean; impact: number; favorable: boolean }[] = [];
    if (best && best.impact > 0) out.push(best);
    if (worst && worst !== best && worst.impact < 0) out.push(worst);
    return out;
  }, [payload.metrics, basis]);

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
      <Card className="flex flex-col items-center justify-center p-5">
        {c.budget ? (
          <>
            <Gauge value={c.actual ?? 0} target={c.budget ?? 0} size={210} label={`${payload.revenue.label} vs budget`} />
            <div className="mt-1 text-xs text-muted tabular-nums">{money(c.actual)} of {money(c.budget)} budget{pct != null ? ` · ${pct}%` : ""}</div>
          </>
        ) : (
          <div className="py-8 text-center">
            <div className="text-xs uppercase tracking-wider text-muted">{payload.revenue.label}</div>
            <div className="mt-1 text-4xl font-light tabular-nums text-ink">{money(c.actual)}</div>
            <div className="mt-1 text-xs text-muted">no budget loaded for this period</div>
          </div>
        )}
        {payload.revenue.companyWide ? <CoTag className="mt-2" /> : null}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col justify-center p-5">
          <div className="text-[11px] uppercase tracking-wider text-muted">{payload.revenue.label} · {payload.basis === "fy" ? "Full-year forecast" : payload.basis === "ytd" ? "YTD" : payload.periodLabel}</div>
          <div className="mt-1 text-4xl font-light tabular-nums text-ink">{money(c.actual)}</div>
          {v != null ? (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
              <span>vs {money(c.budget)} budget</span>
              <Pill favorable={favorable}>{varText(v, "usd", c.budget)}</Pill>
            </div>
          ) : <div className="mt-1.5 text-xs text-muted">no budget to compare</div>}
        </Card>
        <Card className="flex flex-col justify-center gap-2 p-5">
          <div className="text-[11px] uppercase tracking-wider text-muted">What's moving the number</div>
          {movers.length === 0 ? (
            <div className="text-sm text-muted">No budgeted variances for this period yet.</div>
          ) : (
            movers.map((m) => (
              <div key={m.label} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-ink">{m.label}{m.companyWide ? <span className="ml-1 text-[10px] text-amber-600">· co.</span> : null}</span>
                <Pill favorable={m.favorable}>{m.favorable ? "+" : "−"}{moneyK(Math.abs(m.impact))}</Pill>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

// ---- Tile -----------------------------------------------------------------
function Tile({ m, basis, payload }: { m: DMetric; basis: DBasis; payload: DashboardPayload }) {
  const c = cellFor(m.series, basis);
  const { v, favorable } = variance(c, m.higherIsBetter);

  let bar: React.ReactNode = null;
  if (c.actual != null && c.budget != null && c.budget !== 0) {
    const max = Math.max(Math.abs(c.actual), Math.abs(c.budget)) * 1.15 || 1;
    const aw = Math.min(100, (Math.abs(c.actual) / max) * 100);
    const bw = Math.min(100, (Math.abs(c.budget) / max) * 100);
    bar = (
      <div className="flex flex-col gap-1.5">
        <div className="relative h-2 rounded-full" style={{ background: MIST }}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${aw}%`, background: favorable ? `linear-gradient(90deg, ${FAV}, ${SAGE})` : `linear-gradient(90deg, ${UNFAV}, #d9736e)` }} />
          <div className="absolute -top-0.5 -bottom-0.5 w-0.5" style={{ left: `${bw}%`, background: INK, opacity: 0.55 }} />
        </div>
        <div className="flex justify-between text-[10.5px] text-muted">
          <span>actual {fmt(c.actual, m.unit)}</span>
          <span>bdgt {fmt(c.budget, m.unit)}</span>
        </div>
      </div>
    );
  }

  let pctRev: React.ReactNode = null;
  if (m.pctOfRev && m.revDenom) {
    const denom = m.revDenom === "branch" ? payload.revBranch : payload.revCompany;
    const dc = cellFor(denom, basis);
    if (c.actual != null && dc.actual && dc.actual !== 0) {
      const ap = (c.actual / dc.actual) * 100;
      const bp = c.budget != null && dc.budget ? (c.budget / dc.budget) * 100 : null;
      const good = bp == null ? null : ap <= bp;
      pctRev = (
        <div className="text-[11px] text-muted">
          % of {m.revDenom} revenue: <b style={{ color: good == null ? MUTED : good ? FAV : UNFAV }}>{ap.toFixed(1)}%</b>
          {bp != null ? <> vs {bp.toFixed(1)}% target</> : null}
        </div>
      );
    }
  }

  let fyLine: React.ReactNode = null;
  if (basis !== "fy" && m.series.fy.actual != null) {
    const f = m.series.fy;
    const good = f.budget == null ? null : m.higherIsBetter ? f.actual! >= f.budget : f.actual! <= f.budget;
    fyLine = (
      <div className="flex items-center justify-between border-t border-dashed border-line pt-2 text-[11px] text-muted">
        <span>FY forecast</span>
        <span className="flex items-center gap-1.5">
          <b className="text-ink">{fmt(f.actual, m.unit)}</b>
          {f.budget != null ? <>vs {fmt(f.budget, m.unit)}{good != null ? <Pill favorable={good}>{good ? "on track" : "over"}</Pill> : null}</> : <span className="text-muted">no budget</span>}
        </span>
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12.5px] font-semibold text-ink">{m.label}</div>
        {m.companyWide ? <CoTag /> : null}
      </div>
      <div className="text-2xl font-light leading-none tabular-nums text-ink">{fmt(c.actual, m.unit)}</div>
      <div className="text-[11.5px] text-muted">{c.budget == null ? "actual only" : `vs ${fmt(c.budget, m.unit)} budget`}</div>
      <div>{v != null ? <Pill favorable={favorable}>{varText(v, m.unit, c.budget)}</Pill> : <Pill favorable={null}>no target</Pill>}</div>
      {bar}
      {pctRev}
      {m.sub ? (() => {
        const sc = cellFor(m.sub!.series, basis);
        const sv = variance(sc, true);
        if (sc.actual == null) return null;
        return (
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>{m.sub!.label}</span>
            <span className="flex items-center gap-1.5">
              <b className="text-ink">{fmt(sc.actual, "pct")}</b>
              {sc.budget != null ? <>vs {fmt(sc.budget, "pct")}</> : null}
              {sv.v != null ? <Pill favorable={sv.favorable}>{sv.v >= 0 ? "+" : ""}{sv.v.toFixed(1)} pts</Pill> : null}
            </span>
          </div>
        );
      })() : null}
      {fyLine}
    </Card>
  );
}

// ---- Expense mix (donut: cost lines' share of revenue) --------------------
function ExpenseMix({ cost, basis, payload }: { cost: DMetric[]; basis: DBasis; payload: DashboardPayload }) {
  const slices = cost
    .map((m) => ({ label: m.label, value: cellFor(m.series, basis).actual }))
    .filter((s): s is { label: string; value: number } => s.value != null && s.value > 0);
  if (slices.length === 0) return null;
  const rev = cellFor(payload.isCompany ? payload.revCompany : payload.revBranch, basis).actual;
  const total = slices.reduce((s, x) => s + x.value, 0);
  const share = rev && rev > 0 ? Math.round((total / rev) * 100) : null;
  return (
    <Section title="Expense mix" hint={`tracked cost lines${share != null ? ` · ${share}% of revenue` : ""}`}>
      <Card className="p-4">
        <Donut slices={slices} centerLabel="tracked cost" centerValue={moneyK(total)} />
      </Card>
    </Section>
  );
}

// ---- Cost as % of revenue (actual vs target) ------------------------------
function CostRatio({ cost, basis, payload }: { cost: DMetric[]; basis: DBasis; payload: DashboardPayload }) {
  const rows = cost
    .filter((m) => m.pctOfRev && m.revDenom)
    .map((m) => {
      const denom = m.revDenom === "branch" ? payload.revBranch : payload.revCompany;
      const c = cellFor(m.series, basis), dc = cellFor(denom, basis);
      if (c.actual == null || !dc.actual) return null;
      const act = (c.actual / dc.actual) * 100;
      const tgt = c.budget != null && dc.budget ? (c.budget / dc.budget) * 100 : null;
      return { label: m.label + (m.companyWide ? " (co.)" : ""), act, tgt };
    })
    .filter((r): r is { label: string; act: number; tgt: number | null } => r != null);
  if (rows.length === 0) return null;
  const W = 640, rh = 44, pt = 10, pl = 180, pr = 50, iw = W - pl - pr;
  const H = pt * 2 + rows.length * rh;
  const max = Math.max(...rows.flatMap((r) => [r.act, r.tgt ?? 0]), 1) * 1.18;
  const sc = (v: number) => (v / max) * iw;
  return (
    <Section title="Cost as % of revenue" hint="bars past the target tick erode margin">
      <Card className="p-4">
        <div className="mb-2 flex items-center gap-4 text-[11px] text-muted">
          <span className="flex items-center gap-1.5"><span style={{ background: FAV }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Actual %</span>
          <span className="flex items-center gap-1.5"><span style={{ background: INK }} className="inline-block h-3 w-0.5" /> Target %</span>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 460 }} role="img" aria-label="Cost as percent of revenue">
            {rows.map((r, i) => {
              const cy = pt + i * rh + rh / 2;
              const w = sc(r.act);
              const tx = r.tgt != null ? pl + sc(r.tgt) : null;
              const over = r.tgt != null && r.act > r.tgt;
              const col = over ? UNFAV : FAV;
              return (
                <g key={r.label}>
                  <text x={pl - 12} y={cy + 4} textAnchor="end" fontSize={11.5} fill={INK}>{r.label}</text>
                  <rect x={pl} y={cy - 9} width={iw} height={18} rx={5} fill={MIST} />
                  <rect x={pl} y={cy - 9} width={Math.max(2, w)} height={18} rx={5} fill={col} />
                  {tx != null ? <line x1={tx} x2={tx} y1={cy - 13} y2={cy + 13} stroke={INK} strokeWidth={2} /> : null}
                  <text x={pl + w + 8} y={cy + 4} fontSize={11} fontWeight={600} fill={col}>{r.act.toFixed(1)}%</text>
                  {r.tgt != null ? <text x={tx!} y={cy - 16} textAnchor="middle" fontSize={8.5} fill={MUTED}>tgt {r.tgt.toFixed(1)}%</text> : null}
                </g>
              );
            })}
          </svg>
        </div>
      </Card>
    </Section>
  );
}

// ---- YTD variance (diverging) ---------------------------------------------
function YtdVariance({ metrics }: { metrics: DMetric[] }) {
  const rows = metrics
    .map((m) => {
      const c = m.series.ytd;
      if (c.actual == null || c.budget == null || m.unit !== "usd") return null;
      const impact = m.higherIsBetter ? c.actual - c.budget : c.budget - c.actual;
      return { label: m.label + (m.companyWide ? " (co.)" : ""), value: Math.abs(impact), favorable: impact >= 0 };
    })
    .filter((r): r is { label: string; value: number; favorable: boolean } => r != null)
    .sort((a, b) => (b.favorable ? b.value : -b.value) - (a.favorable ? a.value : -a.value));
  if (rows.length === 0) return null;
  return (
    <Section title="Where the year is won & lost" hint="YTD favorable / unfavorable dollar impact · right helps, left hurts">
      <Card className="p-4"><DivergingBars rows={rows} /></Card>
    </Section>
  );
}

// ---- Forecast wall --------------------------------------------------------
function ForecastWall({ metrics }: { metrics: DMetric[] }) {
  const rows = metrics
    .map((m) => {
      const f = m.series.fy;
      if (f.actual == null) return null;
      const { v, favorable } = variance(f, m.higherIsBetter);
      return { m, f, v, favorable };
    })
    .filter((x): x is { m: DMetric; f: DCell; v: number | null; favorable: boolean | null } => x != null);
  if (rows.length === 0) return <Empty>No full-year forecast is loaded for this scope.</Empty>;
  return (
    <Section title="Full-year forecast vs budget" hint="projected year-end landing for every category with a model forecast">
      <TileGrid>
        {rows.map(({ m, f, v, favorable }) => (
          <Card key={m.key} className="flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[12.5px] font-semibold text-ink">{m.label}</div>
              {m.companyWide ? <CoTag /> : null}
            </div>
            <div className="text-2xl font-light leading-none tabular-nums text-ink">{fmt(f.actual, m.unit)}</div>
            <div className="text-[11.5px] text-muted">{f.budget == null ? "forecast only" : `vs ${fmt(f.budget, m.unit)} budget`}</div>
            <div>{v != null ? <Pill favorable={favorable}>{varText(v, m.unit, f.budget)}</Pill> : <Pill favorable={null}>no budget</Pill>}</div>
          </Card>
        ))}
      </TileGrid>
    </Section>
  );
}

// ---- Pace vs mid-year (YTD actual as % of full-year budget) ----------------
function PaceSection({ metrics }: { metrics: DMetric[] }) {
  const rows = metrics
    .map((m) => {
      const yc = m.series.ytd, fc = m.series.fy;
      if (yc.actual == null || fc.budget == null || fc.budget === 0) return null;
      return { label: m.label + (m.companyWide ? " (co.)" : ""), pct: (yc.actual / fc.budget) * 100, cost: !m.higherIsBetter };
    })
    .filter((r): r is { label: string; pct: number; cost: boolean } => r != null);
  if (rows.length === 0) return null;
  const W = 620, rh = 32, pt = 16, pl = 180, pr = 44, iw = W - pl - pr;
  const H = pt * 2 + rows.length * rh;
  const sc = (v: number) => (Math.min(v, 100) / 100) * iw;
  const benchX = pl + sc(50);
  return (
    <Section title="Pace vs the full-year budget" hint="YTD actual as % of the full-year budget — the 50% line is a rough mid-year marker">
      <Card className="p-4">
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 460 }} role="img" aria-label="Pace vs full-year budget">
            <line x1={benchX} x2={benchX} y1={pt - 8} y2={H - pt} stroke={INK} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6} />
            <text x={benchX} y={pt - 10} textAnchor="middle" fontSize={9} fill={MUTED}>50%</text>
            {rows.map((r, i) => {
              const cy = pt + i * rh + rh / 2;
              const w = sc(r.pct);
              const over = r.cost ? r.pct > 50 : r.pct < 50;
              const col = over ? UNFAV : FAV;
              return (
                <g key={r.label}>
                  <text x={pl - 10} y={cy + 4} textAnchor="end" fontSize={11} fill={INK}>{r.label}</text>
                  <rect x={pl} y={cy - 8} width={iw} height={16} rx={4} fill={MIST} />
                  <rect x={pl} y={cy - 8} width={Math.max(2, w)} height={16} rx={4} fill={col} />
                  <text x={pl + w + 6} y={cy + 4} fontSize={10.5} fontWeight={600} fill={col}>{r.pct.toFixed(0)}%</text>
                </g>
              );
            })}
          </svg>
        </div>
      </Card>
    </Section>
  );
}

// ---- Book growth (new sales vs cancellations) ------------------------------
const MONTH_C = { sales: "#1f7a45", cancel: "#c26b6b" };
function BookGrowth({ book }: { book: DashboardPayload["book"] }) {
  const salesMap = new Map(book.salesMonthly.map((p) => [p.label, p.value]));
  const labels = book.salesMonthly.map((p) => p.label);
  const cancelMap = new Map(book.cancelsMonthly.map((p) => [p.label, p.value]));
  const common = labels.filter((l) => cancelMap.has(l));
  if (common.length === 0) return null;
  const salesA = common.map((l) => salesMap.get(l) as number);
  const cancelA = common.map((l) => cancelMap.get(l) as number);
  const net = book.salesYtd != null && book.cancelsYtd != null ? book.salesYtd - book.cancelsYtd : null;

  const W = 680, H = 280, padL = 48, padR = 64, padT = 20, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const all = [...salesA, ...cancelA];
  const max = Math.max(...all, 1) * 1.08, min = Math.min(...all, 0) * 0.9, span = max - min || 1;
  const n = common.length;
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - min) / span) * plotH;
  const poly = (arr: number[]) => arr.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const band = [...salesA.map((v, i) => `${x(i)},${y(v)}`), ...cancelA.map((v, i) => `${x(i)},${y(v)}`).reverse()].join(" ");

  return (
    <Section title="Book growth — new sales vs cancellations" hint={`${book.companyWide ? "company-wide · " : ""}the widening gap is net book growth (real monthly actuals)`}>
      <Card className="p-4">
        <div className="mb-1 flex flex-wrap items-center gap-4 text-[11px] text-muted">
          <span className="flex items-center gap-1.5"><span style={{ background: MONTH_C.sales }} className="inline-block h-0.5 w-4 rounded" /> New sales</span>
          <span className="flex items-center gap-1.5"><span style={{ background: MONTH_C.cancel }} className="inline-block h-0.5 w-4 rounded" /> Cancellations</span>
          <span className="flex items-center gap-1.5"><span style={{ background: MONTH_C.sales, opacity: 0.16 }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Net New</span>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520 }} role="img" aria-label="New sales vs cancellations">
            {[0, 0.5, 1].map((t) => { const gy = padT + plotH - t * plotH; return <g key={t}><line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke="#e7ece8" strokeWidth={1} /><text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={10} fill={MUTED}>{moneyK(min + t * span)}</text></g>; })}
            <polygon points={band} fill={MONTH_C.sales} opacity={0.14} />
            <polyline points={poly(cancelA)} fill="none" stroke={MONTH_C.cancel} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={poly(salesA)} fill="none" stroke={MONTH_C.sales} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {common.map((lb, i) => (
              <g key={lb}>
                <circle cx={x(i)} cy={y(salesA[i])} r={3.5} fill={MONTH_C.sales} />
                <circle cx={x(i)} cy={y(cancelA[i])} r={3.5} fill={MONTH_C.cancel} />
                <text x={x(i)} y={H - padB + 15} textAnchor="middle" fontSize={10} fill={MUTED}>{lb}</text>
              </g>
            ))}
            <text x={x(n - 1) + 6} y={y(salesA[n - 1]) + 3} fontSize={10.5} fontWeight={600} fill={MONTH_C.sales}>Sales</text>
            <text x={x(n - 1) + 6} y={y(cancelA[n - 1]) + 3} fontSize={10.5} fontWeight={600} fill={MONTH_C.cancel}>Cancels</text>
          </svg>
        </div>
        {net != null ? (
          <p className="mt-2 text-[12.5px] text-ink">
            {net >= 0 ? "New sales are outpacing cancellations" : "Cancellations are outpacing new sales"} — net book {net >= 0 ? "growing" : "shrinking"} <b>{money(Math.abs(net))}</b> YTD
            <span className="text-muted"> ({book.scopeLabel}; {money(book.salesYtd)} new sales vs {money(book.cancelsYtd)} cancellations).</span>
          </p>
        ) : null}
      </Card>
    </Section>
  );
}

// ---- Per-branch breakdown (company scope) ----------------------------------
function PerBranch({ cards }: { cards: BranchCard[] }) {
  const present = cards.filter((c) => c.actual != null);
  if (present.length === 0) return null;
  return (
    <Section title="By branch" hint="production · YTD · tap to drill in">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {present.map((b) => {
          const pct = b.budget && b.budget > 0 && b.actual != null ? Math.round((b.actual / b.budget) * 100) : null;
          return (
            <Link key={b.key} href={`/management?branch=${b.key}`} className="block">
              <Card className="overflow-hidden p-4 transition hover:ring-1 hover:ring-brand-300">
                <div className="-mx-4 -mt-4 mb-3 h-1 bg-emerald-grad" />
                <div className="text-xs font-medium uppercase tracking-wider text-muted">{b.label}</div>
                <div className="mt-2 text-2xl font-light tabular-nums">{money(b.actual)}</div>
                <div className="text-[11px] text-muted">production · YTD</div>
                {pct != null ? <div className={`mt-1 text-[11px] ${(b.actual ?? 0) >= (b.budget ?? 0) ? "text-brand-700" : "text-amber-600"}`}>{pct}% of budget</div> : null}
              </Card>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

// ---- Sales funnel ---------------------------------------------------------
function FunnelPanel({ f, scopeLabel }: { f: NonNullable<FunnelSummary>; scopeLabel: string }) {
  const hasData = f.leads > 0 || f.proposals > 0 || f.deals > 0 || f.closed > 0;
  const fmax = Math.max(1, f.leads, f.proposals, f.deals);
  const lToP = f.leads > 0 ? Math.round((f.proposals / f.leads) * 100) : null;
  const pToD = f.proposals > 0 ? Math.round((f.deals / f.proposals) * 100) : null;
  const stages = [
    { label: "Leads", raw: f.leads, value: num(f.leads) },
    { label: "Proposals", raw: f.proposals, value: num(f.proposals) },
    { label: "Closed deals", raw: f.deals, value: num(f.deals) },
    { label: "Closed $", raw: f.closed, value: money(f.closed) },
  ];
  return (
    <Section title="Sales funnel" hint={`${scopeLabel} · this month`}>
      <Card className="p-4 sm:p-5">
        {hasData ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stages.map((s, i) => (
                <div key={s.label} className="rounded-xl border border-line bg-white p-3 text-center">
                  <div className="text-[11px] uppercase tracking-wide text-muted">{s.label}</div>
                  <div className="mt-1 text-2xl font-light tabular-nums text-ink">{s.value}</div>
                  {i < 3 ? (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                      <div className="h-full rounded-full bg-emerald-grad" style={{ width: `${Math.round((s.raw / fmax) * 100)}%` }} />
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-muted">{f.goal > 0 ? `${Math.round((f.closed / f.goal) * 100)}% of goal` : "closed this month"}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
              {lToP != null ? <span><span className="font-medium text-ink">{lToP}%</span> of leads → proposals</span> : null}
              {pToD != null ? <span><span className="font-medium text-ink">{pToD}%</span> of proposals → closed</span> : null}
              <Link href="/sales" className="font-medium text-brand-700 hover:underline">Open the Sales Team board →</Link>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted">No funnel activity logged for {scopeLabel} this month yet. Leads, proposals and closes appear here as the sales team logs them.</p>
            <Link href="/sales" className="text-xs font-medium text-brand-700 hover:underline">Open the Sales Team board →</Link>
          </div>
        )}
      </Card>
    </Section>
  );
}

// ---- Small shared primitives ----------------------------------------------
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {hint ? <span className="text-xs font-light text-muted">· {hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

function Pill({ favorable, children }: { favorable: boolean | null; children: React.ReactNode }) {
  const cls = favorable == null ? "bg-brand-50 text-muted" : favorable ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${cls}`}>{children}</span>;
}

function CoTag({ className = "" }: { className?: string }) {
  return <span className={`shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-700 ${className}`}>company-wide</span>;
}

function Dot() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="mb-6 rounded-xl border border-dashed border-line bg-black/[0.015] px-4 py-6 text-center text-sm text-muted">{children}</div>;
}
