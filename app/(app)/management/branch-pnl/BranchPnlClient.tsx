"use client";

// Branch P&L — Budget vs Actual. A per-branch reading of the June 2026 model:
// budget-vs-actual tiles, story charts, and a flat table, driven by a client
// period toggle (Month · YTD · Full-Year Forecast) and a Tiles/Charts/Table
// view toggle. All figures come from the server (real KpiValue rows) — nothing
// is fabricated here; company-only lines are labeled "company-wide".

import { useState } from "react";
import { Card } from "@/components/ui";
import { money } from "@/lib/format";

// ---- Types (mirror the server payload) ------------------------------------
export type PCell = { actual: number | null; budget: number | null };
export type PSeries = { month: PCell; ytd: PCell; fy: PCell };
export type Metric = {
  key: string;
  label: string;
  group: "rev" | "cost";
  unit: "usd" | "pct" | "count";
  higherIsBetter: boolean;
  companyWide: boolean;
  pctOfRev: boolean;
  revDenom: "branch" | "company" | null;
  series: PSeries;
  sub?: { label: string; unit: "pct"; series: PSeries } | null;
};
export type MonthPt = { label: string; m: number; value: number };
export type BookGrowth = {
  scopeLabel: string;
  companyWide: boolean;
  sales: MonthPt[];
  cancels: MonthPt[];
  salesYtd: number | null;
  cancelsYtd: number | null;
};
export type Payload = {
  branchLabel: string;
  locked: boolean;
  metrics: Metric[];
  revBranch: PSeries;
  revCompany: PSeries;
  bookGrowth: BookGrowth;
};

type Period = "month" | "ytd" | "fy";
type View = "tiles" | "charts" | "table";

// ---- Palette (on the always-light content cards) --------------------------
const FAV = "#2e6f47";
const UNFAV = "#b23a3a";
const SAGE = "#74a96e";
const INK = "#1d2a23";
const MUTED = "#5c6b62";
const MIST = "#dce9df";
const GRID = "#e7ece8";

// ---- Formatting -----------------------------------------------------------
const num = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString("en-US");
const moneyK = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;

function fmt(v: number | null, unit: Metric["unit"]): string {
  if (v == null) return "—";
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit === "count") return num(v);
  return money(v);
}

const cellFor = (s: PSeries, p: Period): PCell => s[p];

function variance(c: PCell, higherIsBetter: boolean) {
  if (c.actual == null || c.budget == null) return { v: null as number | null, favorable: null as boolean | null };
  const v = c.actual - c.budget;
  return { v, favorable: higherIsBetter ? v >= 0 : v <= 0 };
}

function varText(v: number | null, unit: Metric["unit"], budget: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "-";
  const mag = Math.abs(v);
  const abs = unit === "pct" ? `${sign}${mag.toFixed(1)} pts` : unit === "count" ? `${sign}${num(mag)}` : `${sign}${money(mag)}`;
  const pct = budget && budget !== 0 ? ` · ${v / budget >= 0 ? "+" : ""}${((v / budget) * 100).toFixed(1)}%` : "";
  return abs + pct;
}

const PERIOD_LABEL: Record<Period, string> = {
  month: "June 2026",
  ytd: "YTD · Jan–Jun",
  fy: "Full-Year Forecast",
};

// ===========================================================================
export default function BranchPnlClient({ payload }: { payload: Payload }) {
  const [period, setPeriod] = useState<Period>("ytd");
  const [view, setView] = useState<View>("tiles");

  const rev = payload.metrics.filter((m) => m.group === "rev");
  const cost = payload.metrics.filter((m) => m.group === "cost");

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Seg
          ariaLabel="Period"
          solid
          value={period}
          onChange={(v) => setPeriod(v as Period)}
          options={[
            { key: "month", label: "Month" },
            { key: "ytd", label: "YTD" },
            { key: "fy", label: "Full-Year Forecast" },
          ]}
        />
        <div className="flex-1" />
        <Seg
          ariaLabel="View"
          value={view}
          onChange={(v) => setView(v as View)}
          options={[
            { key: "tiles", label: "Tiles" },
            { key: "charts", label: "Charts" },
            { key: "table", label: "Table" },
          ]}
        />
      </div>

      <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-brand-50 px-3 py-1 text-[11px] text-muted">
        Source: <b className="text-ink font-medium">June 2026 model</b> · showing{" "}
        <b className="text-ink font-medium">{PERIOD_LABEL[period]}</b>
      </div>

      {/* Hero */}
      <Hero payload={payload} period={period} />

      {view === "tiles" && (
        <>
          <SectionHead title="Revenue drivers" k="higher is better" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rev.map((m) => (
              <Tile key={m.key} m={m} period={period} payload={payload} />
            ))}
          </div>
          <SectionHead title="Cost lines" k="lower is better · $ and % of revenue" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cost.map((m) => (
              <Tile key={m.key} m={m} period={period} payload={payload} />
            ))}
          </div>
        </>
      )}

      {view === "charts" && <ChartsView payload={payload} period={period} />}

      {view === "table" && <TableView payload={payload} period={period} />}

      <p className="mt-6 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
        <b className="text-ink">How to read:</b> green = favorable (revenue ≥ budget, or cost ≤ budget); red = off.
        Lines tagged <b className="text-ink">company-wide</b> have no branch-level split in the loaded model, so the
        company figure is shown. New Sales has no full-year forecast in the model; it reads n/a there.
      </p>
    </div>
  );
}

// ---- Segmented control ----------------------------------------------------
function Seg({
  options,
  value,
  onChange,
  ariaLabel,
  solid,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  solid?: boolean;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-xl border border-line bg-brand-50 p-1">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              active
                ? solid
                  ? "bg-emerald-grad text-white shadow"
                  : "bg-white text-ink shadow"
                : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionHead({ title, k }: { title: string; k: string }) {
  return (
    <div className="mb-3 mt-6 flex items-center gap-2">
      <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      <span className="text-xs font-light text-muted">· {k}</span>
    </div>
  );
}

function Pill({ favorable, children }: { favorable: boolean | null; children: React.ReactNode }) {
  const cls =
    favorable == null
      ? "bg-brand-50 text-muted"
      : favorable
        ? "bg-emerald-100 text-emerald-800"
        : "bg-red-100 text-red-700";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${cls}`}>{children}</span>;
}

// ---- Hero -----------------------------------------------------------------
function Hero({ payload, period }: { payload: Payload; period: Period }) {
  const pick = (key: string) => payload.metrics.find((m) => m.key === key);
  const cards = [pick("production"), pick("net_after_labor")].filter(Boolean) as Metric[];
  const margin = pick("net_after_labor")?.sub ?? null;

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      {cards.map((m) => {
        const c = cellFor(m.series, period);
        const { v, favorable } = variance(c, m.higherIsBetter);
        return (
          <Card key={m.key} className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted">{m.label}</div>
            <div className="mt-1.5 text-3xl font-light tabular-nums text-ink">{fmt(c.actual, m.unit)}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted">
              <span>vs {fmt(c.budget, m.unit)} budget</span>
              {v != null && <Pill favorable={favorable}>{varText(v, m.unit, c.budget)}</Pill>}
            </div>
          </Card>
        );
      })}
      {margin && (
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted">{margin.label}</div>
          {(() => {
            const c = cellFor(margin.series, period);
            const { v, favorable } = variance(c, true);
            return (
              <>
                <div className="mt-1.5 text-3xl font-light tabular-nums text-ink">{fmt(c.actual, "pct")}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <span>vs {fmt(c.budget, "pct")} budget</span>
                  {v != null && <Pill favorable={favorable}>{varText(v, "pct", c.budget)}</Pill>}
                </div>
              </>
            );
          })()}
        </Card>
      )}
    </div>
  );
}

// ---- Tile -----------------------------------------------------------------
function Tile({ m, period, payload }: { m: Metric; period: Period; payload: Payload }) {
  const c = cellFor(m.series, period);
  const { v, favorable } = variance(c, m.higherIsBetter);

  // Bar: fill to actual, tick at budget. Only when both exist.
  let bar: React.ReactNode = null;
  if (c.actual != null && c.budget != null) {
    const max = Math.max(c.actual, c.budget) * 1.15 || 1;
    const aw = Math.min(100, (c.actual / max) * 100);
    const bw = (c.budget / max) * 100;
    bar = (
      <div className="flex flex-col gap-1.5">
        <div className="relative h-2 rounded-full" style={{ background: MIST }}>
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${aw}%`, background: favorable ? `linear-gradient(90deg, ${FAV}, ${SAGE})` : `linear-gradient(90deg, ${UNFAV}, #d9736e)` }}
          />
          <div className="absolute -top-0.5 -bottom-0.5 w-0.5" style={{ left: `${bw}%`, background: INK, opacity: 0.55 }} />
        </div>
        <div className="flex justify-between text-[10.5px] text-muted">
          <span>actual {fmt(c.actual, m.unit)}</span>
          <span>bdgt {fmt(c.budget, m.unit)}</span>
        </div>
      </div>
    );
  }

  // Cost lines: % of revenue (actual vs target).
  let pctRev: React.ReactNode = null;
  if (m.pctOfRev && m.revDenom) {
    const denom = m.revDenom === "branch" ? payload.revBranch : payload.revCompany;
    const dc = cellFor(denom, period);
    if (c.actual != null && dc.actual && dc.actual !== 0) {
      const ap = (c.actual / dc.actual) * 100;
      const bp = c.budget != null && dc.budget ? (c.budget / dc.budget) * 100 : null;
      const good = bp == null ? null : ap <= bp;
      pctRev = (
        <div className="text-[11px] text-muted">
          % of {m.revDenom === "branch" ? "branch" : "company"} revenue:{" "}
          <b style={{ color: good == null ? MUTED : good ? FAV : UNFAV }}>{ap.toFixed(1)}%</b>
          {bp != null && <> vs {bp.toFixed(1)}% target</>}
        </div>
      );
    }
  }

  // Per-tile FY forecast line (skip when already viewing FY, or no fy actual).
  let fyLine: React.ReactNode = null;
  if (period !== "fy" && m.series.fy.actual != null) {
    const f = m.series.fy;
    const good = f.budget == null ? null : m.higherIsBetter ? f.actual! >= f.budget : f.actual! <= f.budget;
    fyLine = (
      <div className="flex items-center justify-between border-t border-dashed border-line pt-2 text-[11px] text-muted">
        <span>FY forecast</span>
        <span className="flex items-center gap-1.5">
          <b className="text-ink">{fmt(f.actual, m.unit)}</b>
          {f.budget != null ? (
            <>
              vs {fmt(f.budget, m.unit)}
              {good != null && <Pill favorable={good}>{good ? "on track" : "over"}</Pill>}
            </>
          ) : (
            <span className="text-muted">no budget</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-semibold text-ink">{m.label}</div>
        {m.companyWide && (
          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-700">
            company-wide
          </span>
        )}
      </div>
      <div className="text-2xl font-light leading-none tabular-nums text-ink">{fmt(c.actual, m.unit)}</div>
      <div className="text-[11.5px] text-muted">{c.budget == null ? "actual only" : `vs ${fmt(c.budget, m.unit)} budget`}</div>
      <div>{v != null ? <Pill favorable={favorable}>{varText(v, m.unit, c.budget)}</Pill> : <Pill favorable={null}>no target</Pill>}</div>
      {bar}
      {pctRev}
      {m.sub &&
        (() => {
          const sc = cellFor(m.sub!.series, period);
          const sv = variance(sc, true);
          return (
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>{m.sub!.label}</span>
              <span className="flex items-center gap-1.5">
                <b className="text-ink">{fmt(sc.actual, "pct")}</b>
                {sc.budget != null && <>vs {fmt(sc.budget, "pct")}</>}
                {sv.v != null && <Pill favorable={sv.favorable}>{sv.v >= 0 ? "+" : ""}{sv.v.toFixed(1)} pts</Pill>}
              </span>
            </div>
          );
        })()}
      {fyLine}
    </Card>
  );
}

// ===========================================================================
// CHARTS VIEW
// ===========================================================================
function ChartsView({ payload, period }: { payload: Payload; period: Period }) {
  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-ink">Book growth — new sales vs cancellations · 2026</h3>
            <p className="mt-0.5 text-xs text-muted">
              Solid = actual monthly closes; dashed = illustrative pace ahead. The shaded band is Net New ARR — the
              widening gap is book growth.
            </p>
          </div>
          {payload.bookGrowth.companyWide && (
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-700">
              company-wide
            </span>
          )}
        </div>
        <BookGrowthChart bg={payload.bookGrowth} />
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-medium text-ink">Budget vs actual by line · {PERIOD_LABEL[period]}</h3>
        <p className="mt-0.5 text-xs text-muted">Dollar lines for the selected period. Solid = actual, outline = budget.</p>
        <ActualVsBudget payload={payload} period={period} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-medium text-ink">Where the year is won &amp; lost</h3>
          <p className="mt-0.5 text-xs text-muted">YTD favorable / unfavorable dollar impact by line. Right helps the bottom line; left hurts it.</p>
          <VarianceBars payload={payload} />
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-medium text-ink">Spend / earn pace vs mid-year</h3>
          <p className="mt-0.5 text-xs text-muted">YTD actual as % of the full-year budget. Past 50% at mid-year = burning fast (cost) / ahead (revenue).</p>
          <PaceBars payload={payload} />
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-medium text-ink">Cost as % of revenue — actual vs target · {PERIOD_LABEL[period]}</h3>
        <p className="mt-0.5 text-xs text-muted">Controllable ratios that drive margin. Bars past the target tick erode contribution.</p>
        <CostRatio payload={payload} period={period} />
      </Card>
    </div>
  );
}

// Chart 1 — grouped actual vs budget (usd revenue+cost lines).
function ActualVsBudget({ payload, period }: { payload: Payload; period: Period }) {
  const rows = payload.metrics
    .filter((m) => m.unit === "usd")
    .map((m) => {
      const c = cellFor(m.series, period);
      return { label: m.label, actual: c.actual, budget: c.budget, companyWide: m.companyWide };
    })
    .filter((r) => r.actual != null);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">No dollar lines for this period.</p>;

  const W = 680, H = 260, padL = 8, padR = 8, padT = 24, padB = 52;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...rows.flatMap((r) => [r.actual ?? 0, r.budget ?? 0]), 1);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const gc = rows.length, gGap = 26;
  const groupW = (plotW - gGap * (gc - 1)) / gc;
  const bw = Math.min(42, (groupW - 8) / 2);

  return (
    <div className="mt-3 overflow-x-auto">
      <div className="mb-2 flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span style={{ background: FAV }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Actual</span>
        <span className="flex items-center gap-1.5"><span style={{ border: `1.5px solid ${MUTED}`, background: "transparent" }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Budget</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480 }} role="img" aria-label="Budget vs actual by line">
        {rows.map((r, i) => {
          const gx = padL + i * (groupW + gGap);
          const ax = gx + groupW / 2 - bw - 2, bx = gx + groupW / 2 + 2;
          const a = r.actual ?? 0;
          const words = r.label.split(" ");
          return (
            <g key={r.label}>
              {r.budget != null && (
                <rect x={bx} y={y(r.budget)} width={bw} height={padT + plotH - y(r.budget)} rx={4} fill="transparent" stroke={MUTED} strokeWidth={1.5} />
              )}
              <rect x={ax} y={y(a)} width={bw} height={padT + plotH - y(a)} rx={4} fill={FAV} />
              <text x={gx + groupW / 2} y={y(a) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>{moneyK(a)}</text>
              {words.slice(0, 2).map((w, wi) => (
                <text key={wi} x={gx + groupW / 2} y={H - padB + 16 + wi * 12} textAnchor="middle" fontSize={10} fill={MUTED}>{w}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Chart 2 — diverging YTD variance impact.
function VarianceBars({ payload }: { payload: Payload }) {
  const rows = payload.metrics
    .map((m) => {
      const c = m.series.ytd;
      if (c.actual == null || c.budget == null || m.unit !== "usd") return null;
      const impact = m.higherIsBetter ? c.actual - c.budget : c.budget - c.actual;
      return { label: m.label + (m.companyWide ? " (co.)" : ""), impact };
    })
    .filter((r): r is { label: string; impact: number } => r != null)
    .sort((a, b) => b.impact - a.impact);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">No YTD variance data.</p>;

  const W = 520, rh = 32, pt = 6, pl = 150, pr = 56, iw = W - pl - pr;
  const H = pt * 2 + rows.length * rh;
  const max = Math.max(...rows.map((r) => Math.abs(r.impact))) * 1.05 || 1;
  const zero = pl + iw / 2;
  const sc = (v: number) => (v / max) * (iw / 2);

  return (
    <div className="mt-3 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 440 }} role="img" aria-label="YTD variance by line">
        <line x1={zero} x2={zero} y1={pt} y2={H - pt} stroke={GRID} strokeWidth={1} />
        {rows.map((r, i) => {
          const cy = pt + i * rh + rh / 2;
          const good = r.impact >= 0;
          const w = Math.abs(sc(r.impact));
          const bx = good ? zero : zero - w;
          return (
            <g key={r.label}>
              <text x={pl - 10} y={cy + 4} textAnchor="end" fontSize={11} fill={INK}>{r.label}</text>
              <rect x={bx} y={cy - 8} width={w} height={16} rx={4} fill={good ? FAV : UNFAV} />
              <text x={good ? bx + w + 6 : bx - 6} y={cy + 4} textAnchor={good ? "start" : "end"} fontSize={10.5} fontWeight={600} fill={good ? FAV : UNFAV}>
                {(r.impact >= 0 ? "+" : "-")}${Math.abs(Math.round(r.impact / 1000))}K
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Chart 3 — pace: YTD actual as % of full-year budget.
function PaceBars({ payload }: { payload: Payload }) {
  const rows = payload.metrics
    .map((m) => {
      const yc = m.series.ytd, fc = m.series.fy;
      if (yc.actual == null || fc.budget == null || fc.budget === 0) return null;
      return { label: m.label + (m.companyWide ? " (co.)" : ""), pct: (yc.actual / fc.budget) * 100, cost: !m.higherIsBetter };
    })
    .filter((r): r is { label: string; pct: number; cost: boolean } => r != null);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">No full-year budget to pace against.</p>;

  const W = 520, rh = 32, pt = 14, pl = 150, pr = 44, iw = W - pl - pr;
  const H = pt * 2 + rows.length * rh;
  const max = 100;
  const sc = (v: number) => (Math.min(v, max) / max) * iw;
  const benchX = pl + sc(50);

  return (
    <div className="mt-3 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 440 }} role="img" aria-label="Spend/earn pace vs mid-year">
        <line x1={benchX} x2={benchX} y1={pt - 8} y2={H - pt} stroke={INK} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.6} />
        <text x={benchX} y={pt - 10} textAnchor="middle" fontSize={9} fill={MUTED}>50% (mid-yr)</text>
        {rows.map((r, i) => {
          const cy = pt + i * rh + rh / 2;
          const w = sc(r.pct);
          const over = r.cost ? r.pct > 50 : r.pct < 50;
          const col = over ? UNFAV : FAV;
          return (
            <g key={r.label}>
              <text x={pl - 10} y={cy + 4} textAnchor="end" fontSize={11} fill={INK}>{r.label}</text>
              <rect x={pl} y={cy - 8} width={iw} height={16} rx={4} fill={MIST} />
              <rect x={pl} y={cy - 8} width={w} height={16} rx={4} fill={col} />
              <text x={pl + w + 6} y={cy + 4} fontSize={10.5} fontWeight={600} fill={col}>{r.pct.toFixed(0)}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Chart 4 — cost as % of revenue vs target.
function CostRatio({ payload, period }: { payload: Payload; period: Period }) {
  const rows = payload.metrics
    .filter((m) => m.pctOfRev && m.revDenom)
    .map((m) => {
      const denom = m.revDenom === "branch" ? payload.revBranch : payload.revCompany;
      const c = cellFor(m.series, period), dc = cellFor(denom, period);
      if (c.actual == null || !dc.actual) return null;
      const act = (c.actual / dc.actual) * 100;
      const tgt = c.budget != null && dc.budget ? (c.budget / dc.budget) * 100 : null;
      return { label: m.label + (m.companyWide ? " (co.)" : ""), act, tgt };
    })
    .filter((r): r is { label: string; act: number; tgt: number | null } => r != null);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">No cost-ratio data for this period.</p>;

  const W = 680, rh = 46, pt = 10, pl = 190, pr = 52, iw = W - pl - pr;
  const H = pt * 2 + rows.length * rh;
  const max = Math.max(...rows.flatMap((r) => [r.act, r.tgt ?? 0])) * 1.18 || 1;
  const sc = (v: number) => (v / max) * iw;

  return (
    <div className="mt-3 overflow-x-auto">
      <div className="mb-2 flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span style={{ background: FAV }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Actual %</span>
        <span className="flex items-center gap-1.5"><span style={{ background: INK }} className="inline-block h-3 w-0.5" /> Target %</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480 }} role="img" aria-label="Cost as percent of revenue">
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
              <rect x={pl} y={cy - 9} width={w} height={18} rx={5} fill={col} />
              {tx != null && <line x1={tx} x2={tx} y1={cy - 13} y2={cy + 13} stroke={INK} strokeWidth={2} />}
              <text x={pl + w + 8} y={cy + 4} fontSize={11} fontWeight={600} fill={col}>{r.act.toFixed(1)}%</text>
              {r.tgt != null && <text x={tx!} y={cy - 16} textAnchor="middle" fontSize={8.5} fill={MUTED}>tgt {r.tgt.toFixed(1)}%</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Book-growth: two lines (new sales vs cancellations) with a shaded Net New ARR
// band. Solid over actual months, dashed illustrative pace for the months ahead.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SALES_C = "#2e6f47";
const CANCEL_C = "#c26b6b";

function BookGrowthChart({ bg }: { bg: BookGrowth }) {
  const [hover, setHover] = useState<number | null>(null);

  // Align both series to the months present in BOTH (real, comparable points).
  const salesMap = new Map(bg.sales.map((p) => [p.m, p.value]));
  const cancelMap = new Map(bg.cancels.map((p) => [p.m, p.value]));
  const actualMonths = [...salesMap.keys()].filter((m) => cancelMap.has(m)).sort((a, b) => a - b);
  const actualLen = actualMonths.length;
  if (actualLen === 0) {
    return <p className="py-8 text-center text-sm text-muted">No monthly new-sales / cancellation history is loaded.</p>;
  }
  const salesA = actualMonths.map((m) => salesMap.get(m) as number);
  const cancelA = actualMonths.map((m) => cancelMap.get(m) as number);
  const lastMonth = actualMonths[actualLen - 1]; // 1-12

  // Illustrative pace ahead: hold the trailing 3-month average flat through Dec.
  const tail = Math.max(1, Math.min(3, actualLen));
  const avg = (a: number[]) => a.slice(-tail).reduce((s, v) => s + v, 0) / tail;
  const salesPace = avg(salesA), cancelPace = avg(cancelA);
  const fcMonths: number[] = [];
  for (let mm = lastMonth + 1; mm <= 12; mm++) fcMonths.push(mm);

  const salesAll = [...salesA, ...fcMonths.map(() => salesPace)];
  const cancelAll = [...cancelA, ...fcMonths.map(() => cancelPace)];
  const total = salesAll.length;
  const labels = [...actualMonths, ...fcMonths].map((m) => MONTHS[m - 1] ?? "");

  const W = 700, H = 300, padL = 48, padR = 70, padT = 20, padB = 44;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const all = [...salesAll, ...cancelAll];
  const max = Math.max(...all) * 1.08;
  const min = Math.min(...all, 0) * 0.9;
  const span = max - min || 1;
  const x = (i: number) => padL + (total <= 1 ? plotW / 2 : (i / (total - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - min) / span) * plotH;

  const pts = (arr: number[], a: number, b: number) => arr.slice(a, b).map((v, k) => `${x(a + k)},${y(v)}`).join(" ");
  const todayX = x(actualLen - 1);

  // Net New ARR band (between the two lines), full span.
  const band = [
    ...salesAll.map((v, i) => `${x(i)},${y(v)}`),
    ...cancelAll.map((v, i) => `${x(i)},${y(v)}`).reverse(),
  ].join(" ");

  const netYtd = bg.salesYtd != null && bg.cancelsYtd != null ? bg.salesYtd - bg.cancelsYtd : null;

  return (
    <div className="mt-2">
      <div className="mb-1 flex flex-wrap items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span style={{ background: SALES_C }} className="inline-block h-0.5 w-4 rounded" /> New sales</span>
        <span className="flex items-center gap-1.5"><span style={{ background: CANCEL_C }} className="inline-block h-0.5 w-4 rounded" /> Cancellations</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: MUTED }} /> Illustrative pace</span>
        <span className="flex items-center gap-1.5"><span style={{ background: SALES_C, opacity: 0.16 }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Net New ARR</span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ minWidth: 520 }}
          role="img"
          aria-label="New sales vs cancellations over 2026"
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((t) => {
            const gy = padT + plotH - t * plotH;
            return (
              <g key={t}>
                <line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke={GRID} strokeWidth={1} />
                <text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={10} fill={MUTED}>{moneyK(min + t * span)}</text>
              </g>
            );
          })}

          {/* Net New ARR band */}
          <polygon points={band} fill={SALES_C} opacity={0.14} />

          {/* today divider */}
          <line x1={todayX} y1={padT} x2={todayX} y2={padT + plotH} stroke={MUTED} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
          <text x={todayX + 4} y={padT + 10} fontSize={9.5} fill={MUTED}>today ({MONTHS[lastMonth - 1]})</text>

          {/* Cancellations */}
          <polyline points={pts(cancelAll, 0, actualLen)} fill="none" stroke={CANCEL_C} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {fcMonths.length > 0 && (
            <polyline points={pts(cancelAll, actualLen - 1, total)} fill="none" stroke={CANCEL_C} strokeWidth={2.5} strokeDasharray="5 4" opacity={0.8} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {/* New sales */}
          <polyline points={pts(salesAll, 0, actualLen)} fill="none" stroke={SALES_C} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {fcMonths.length > 0 && (
            <polyline points={pts(salesAll, actualLen - 1, total)} fill="none" stroke={SALES_C} strokeWidth={2.5} strokeDasharray="5 4" opacity={0.85} strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* dots + hover targets */}
          {labels.map((_, i) => {
            const isFc = i > actualLen - 1;
            const emphasize = i === actualLen - 1;
            return (
              <g key={i}>
                <circle cx={x(i)} cy={y(cancelAll[i])} r={emphasize ? 4.5 : isFc ? 3 : 3.5} fill={isFc ? "#ffffff" : CANCEL_C} stroke={CANCEL_C} strokeWidth={isFc ? 1.5 : 0} />
                <circle cx={x(i)} cy={y(salesAll[i])} r={emphasize ? 4.5 : isFc ? 3 : 3.5} fill={isFc ? "#ffffff" : SALES_C} stroke={SALES_C} strokeWidth={isFc ? 1.5 : 0} />
                <rect x={x(i) - plotW / (total * 2)} y={padT} width={plotW / total} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                <text x={x(i)} y={H - padB + 15} textAnchor="middle" fontSize={10} fill={MUTED}>{labels[i]}</text>
              </g>
            );
          })}

          {/* end labels */}
          <text x={x(total - 1) + 6} y={y(salesAll[total - 1]) + 3} fontSize={10.5} fontWeight={600} fill={SALES_C}>Sales</text>
          <text x={x(total - 1) + 6} y={y(cancelAll[total - 1]) + 3} fontSize={10.5} fontWeight={600} fill={CANCEL_C}>Cancels</text>

          {hover != null && (() => {
            const isFc = hover > actualLen - 1;
            const rows = [
              `${labels[hover]} 2026${isFc ? " · illustrative" : ""}`,
              `New sales ${moneyK(salesAll[hover])}`,
              `Cancels ${moneyK(cancelAll[hover])}`,
              `Net ${moneyK(salesAll[hover] - cancelAll[hover])}`,
            ];
            const w = Math.max(...rows.map((r) => r.length)) * 6.3 + 16;
            let tx = x(hover) + 12;
            if (tx + w > W) tx = x(hover) - 12 - w;
            const ty = padT + 6;
            return (
              <g pointerEvents="none">
                <rect x={tx} y={ty} width={w} height={rows.length * 15 + 8} rx={6} fill={INK} opacity={0.96} />
                {rows.map((r, i) => (
                  <text key={i} x={tx + 8} y={ty + 16 + i * 15} fontSize={11} fontWeight={i === 0 ? 600 : 400} fill="#ffffff">{r}</text>
                ))}
              </g>
            );
          })()}
        </svg>
      </div>
      {netYtd != null && (
        <p className="mt-2 text-[12.5px] text-ink">
          {netYtd >= 0 ? "New sales are outpacing cancellations" : "Cancellations are outpacing new sales"} —{" "}
          net book {netYtd >= 0 ? "growing" : "shrinking"} <b>{money(Math.abs(netYtd))}</b> YTD
          <span className="text-muted"> ({bg.scopeLabel}; {money(bg.salesYtd)} new sales vs {money(bg.cancelsYtd)} cancellations).</span>
        </p>
      )}
    </div>
  );
}

// ===========================================================================
// TABLE VIEW
// ===========================================================================
function TableView({ payload, period }: { payload: Payload; period: Period }) {
  const groups: { g: "rev" | "cost"; name: string }[] = [
    { g: "rev", name: "Revenue drivers" },
    { g: "cost", name: "Cost lines" },
  ];
  return (
    <div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2.5 font-semibold">Line item</th>
              <th className="px-3 py-2.5 text-right font-semibold">Actual</th>
              <th className="px-3 py-2.5 text-right font-semibold">Budget</th>
              <th className="px-3 py-2.5 text-right font-semibold">Var</th>
              <th className="px-3 py-2.5 text-right font-semibold">Var %</th>
              <th className="px-3 py-2.5 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ g, name }) => {
              const rows = payload.metrics.filter((m) => m.group === g);
              return (
                <>
                  <tr key={g} className="bg-brand-50">
                    <td colSpan={6} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">{name}</td>
                  </tr>
                  {rows.map((m) => {
                    const c = cellFor(m.series, period);
                    const { v, favorable } = variance(c, m.higherIsBetter);
                    const pct = v != null && c.budget && c.budget !== 0 ? `${v / c.budget >= 0 ? "+" : ""}${((v / c.budget) * 100).toFixed(1)}%` : "—";
                    const cls = v == null ? "text-muted" : favorable ? "text-emerald-700" : "text-red-600";
                    return (
                      <tr key={m.key} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 text-ink">
                          {m.label}
                          {m.companyWide && <span className="ml-1.5 text-[10px] text-amber-600">· company-wide</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">{fmt(c.actual, m.unit)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{fmt(c.budget, m.unit)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${cls}`}>{v == null ? "—" : varText(v, m.unit, null)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${cls}`}>{pct}</td>
                        <td className="px-3 py-2 text-right">
                          {v == null ? <Pill favorable={null}>no target</Pill> : <Pill favorable={favorable}>{favorable ? "On/Better" : "Off"}</Pill>}
                        </td>
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="mt-2.5 text-[11.5px] text-muted">
        Showing <b className="text-ink">{PERIOD_LABEL[period]}</b> — recomputes with the period toggle.
      </p>
    </div>
  );
}
