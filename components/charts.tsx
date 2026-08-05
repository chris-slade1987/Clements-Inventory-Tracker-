"use client";

// Lightweight inline-SVG charts for the management dashboards. No dependencies.
// Colors come from the validated data-viz reference palette; single-series marks
// use the brand emerald. Each chart pairs with a data table elsewhere on the
// page (the accessible table view) and adds a hover/tap tooltip for exact values.

import { useState } from "react";

const INK = "#0b2e22";
const MUTED = "#5b7a70";
const GRID = "#d5e6e0";
const EMERALD = "#059669";
const BUDGET = "#9fb8b0";
const DECREASE = "#e08a5a"; // waterfall deductions (status "serious")

// Categorical slots (light mode) from references/palette.md, CVD-safe order.
export const SERIES = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const moneyK = (n: number) => (Math.abs(n) >= 1_000_000 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`);

type Hover = { x: number; y: number; rows: string[] } | null;

// In-SVG tooltip, clamped to the viewBox so it never clips.
function Tip({ hover, W }: { hover: Hover; W: number }) {
  if (!hover) return null;
  const pad = 8, lh = 15, charW = 6.4;
  const w = Math.max(...hover.rows.map((r) => r.length)) * charW + pad * 2;
  const h = hover.rows.length * lh + pad;
  let tx = hover.x + 12;
  if (tx + w > W) tx = hover.x - 12 - w;
  if (tx < 0) tx = 4;
  let ty = hover.y - h - 10;
  if (ty < 0) ty = hover.y + 14;
  return (
    <g pointerEvents="none">
      <rect x={tx} y={ty} width={w} height={h} rx={6} fill={INK} opacity={0.96} />
      {hover.rows.map((r, i) => (
        <text key={i} x={tx + pad} y={ty + pad + 4 + i * lh} fontSize={11} fontWeight={i === 0 ? 600 : 400} fill="#ffffff">{r}</text>
      ))}
    </g>
  );
}

// ---- Waterfall -------------------------------------------------------------
const INCREASE = "#1f9d63"; // waterfall additions (positive)

export function Waterfall({
  steps,
  height = 240,
}: {
  steps: { label: string; value: number; kind: "total" | "decrease" | "increase" }[];
  height?: number;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const W = 640, H = height, padL = 8, padR = 8, padT = 24, padB = 44;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  // Scale to the highest running balance reached, not just the largest step.
  let peak = 0, run = 0;
  for (const s of steps) {
    if (s.kind === "total") run = s.value;
    else if (s.kind === "increase") run += s.value;
    else run -= s.value;
    peak = Math.max(peak, run, s.value);
  }
  const max = peak || 1;
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const n = steps.length, gap = 14, bw = (plotW - gap * (n - 1)) / n;

  let running = 0;
  const bars = steps.map((s, i) => {
    const x = padL + i * (bw + gap);
    let top: number, bot: number, color: string;
    if (s.kind === "total") { top = y(s.value); bot = y(0); color = EMERALD; running = s.value; }
    else if (s.kind === "increase") { const start = running; const end = running + s.value; top = y(end); bot = y(start); color = INCREASE; running = end; }
    else { const start = running; const end = running - s.value; top = y(start); bot = y(end); color = DECREASE; running = end; }
    return { s, x, top, h: Math.max(2, bot - top), color, runY: y(running) };
  });

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 460 }} role="img" aria-label="Route contribution waterfall">
        {bars.map((b, i) => (
          <g key={i}>
            {i > 0 && <line x1={bars[i - 1].x + bw} y1={bars[i - 1].runY} x2={b.x} y2={bars[i - 1].runY} stroke={GRID} strokeWidth={1.5} strokeDasharray="3 3" />}
            <rect
              x={b.x} y={b.top} width={bw} height={b.h} rx={4} fill={b.color}
              onMouseEnter={() => setHover({ x: b.x + bw / 2, y: b.top, rows: [b.s.label, `${b.s.kind === "decrease" ? "−" : ""}${money0(b.s.value)}`] })}
              onMouseLeave={() => setHover(null)}
              onTouchStart={() => setHover({ x: b.x + bw / 2, y: b.top, rows: [b.s.label, `${b.s.kind === "decrease" ? "−" : ""}${money0(b.s.value)}`] })}
            />
            <text x={b.x + bw / 2} y={b.top - 6} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>{b.s.kind === "decrease" ? "−" : ""}{moneyK(b.s.value)}</text>
            <text x={b.x + bw / 2} y={H - padB + 16} textAnchor="middle" fontSize={11} fill={MUTED}>{b.s.label.length > 12 ? b.s.label.slice(0, 11) + "…" : b.s.label}</text>
          </g>
        ))}
        <Tip hover={hover} W={W} />
      </svg>
    </div>
  );
}

// ---- Grouped bars (actual vs budget) --------------------------------------
export function GroupedBars({
  groups,
  height = 240,
}: {
  groups: { label: string; actual: number; budget: number | null }[];
  height?: number;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const W = 640, H = height, padL = 8, padR = 8, padT = 24, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...groups.flatMap((g) => [g.actual, g.budget ?? 0]), 1);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const gc = groups.length, gGap = 24;
  const groupW = (plotW - gGap * (gc - 1)) / gc;
  const bw = Math.min(46, (groupW - 8) / 2);

  return (
    <div className="overflow-x-auto">
      <div className="mb-2 flex items-center gap-4 text-[11px]" style={{ color: MUTED }}>
        <span className="flex items-center gap-1.5"><span style={{ background: EMERALD }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Actual</span>
        <span className="flex items-center gap-1.5"><span style={{ background: BUDGET }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Budget</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 460 }} role="img" aria-label="Production actual vs budget by branch">
        {groups.map((g, i) => {
          const gx = padL + i * (groupW + gGap);
          const ax = gx + groupW / 2 - bw - 2, bx = gx + groupW / 2 + 2;
          const rows = [g.label, `Actual ${money0(g.actual)}`, ...(g.budget != null ? [`Budget ${money0(g.budget)}`] : [])];
          const set = () => setHover({ x: gx + groupW / 2, y: y(g.actual), rows });
          return (
            <g key={g.label} onMouseEnter={set} onMouseLeave={() => setHover(null)} onTouchStart={set}>
              {g.budget != null && <rect x={bx} y={y(g.budget)} width={bw} height={padT + plotH - y(g.budget)} rx={4} fill={BUDGET} />}
              <rect x={ax} y={y(g.actual)} width={bw} height={padT + plotH - y(g.actual)} rx={4} fill={EMERALD} />
              <text x={ax + bw / 2} y={y(g.actual) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>{moneyK(g.actual)}</text>
              <text x={gx + groupW / 2} y={H - padB + 16} textAnchor="middle" fontSize={11} fill={MUTED}>{g.label}</text>
            </g>
          );
        })}
        <Tip hover={hover} W={W} />
      </svg>
    </div>
  );
}

// ---- Multi-series line -----------------------------------------------------
export function LineChart({
  series,
  xLabels,
  height = 260,
}: {
  series: { name: string; points: (number | null)[] }[];
  xLabels: string[];
  height?: number;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const W = 640, H = height, padL = 44, padR = 60, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const all = series.flatMap((s) => s.points).filter((v): v is number => v != null);
  const max = Math.max(...all, 1), min = Math.min(...all, 0);
  const span = max - min || 1;
  const x = (i: number) => padL + (xLabels.length === 1 ? plotW / 2 : (i / (xLabels.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - min) / span) * plotH;
  // Stagger end-labels that would collide.
  const ends = series.map((s, si) => ({ si, name: s.name, v: s.points[s.points.length - 1], color: SERIES[si % SERIES.length] }))
    .filter((e) => e.v != null).sort((a, b) => (b.v as number) - (a.v as number));
  const endY: Record<number, number> = {};
  let prevY = -Infinity;
  for (const e of ends) { let ly = y(e.v as number); if (ly - prevY < 14) ly = prevY + 14; endY[e.si] = ly; prevY = ly; }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480 }} role="img" aria-label="New sales by branch over time">
        {[0, 0.5, 1].map((t) => {
          const gy = padT + plotH - t * plotH;
          return <g key={t}><line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke={GRID} strokeWidth={1} /><text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={10} fill={MUTED}>{moneyK(min + t * span)}</text></g>;
        })}
        {xLabels.map((lb, i) => <text key={lb + i} x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize={11} fill={MUTED}>{lb}</text>)}
        {series.map((s, si) => {
          const color = SERIES[si % SERIES.length];
          const pts = s.points.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
          return (
            <g key={s.name}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((v, i) => v == null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={color}
                  onMouseEnter={() => setHover({ x: x(i), y: y(v), rows: [s.name, `${xLabels[i]}: ${money0(v)}`] })}
                  onMouseLeave={() => setHover(null)}
                  onTouchStart={() => setHover({ x: x(i), y: y(v), rows: [s.name, `${xLabels[i]}: ${money0(v)}`] })} />
              ))}
              {endY[si] != null && <text x={x(s.points.length - 1) + 7} y={endY[si] + 3} fontSize={11} fontWeight={600} fill={color}>{s.name}</text>}
            </g>
          );
        })}
        <Tip hover={hover} W={W} />
      </svg>
    </div>
  );
}

// ---- Area trend (single series, optional budget line) ---------------------
export function AreaTrend({
  points,
  height = 200,
}: {
  points: { label: string; value: number | null; budget?: number | null }[];
  height?: number;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const W = 640, H = height, padL = 48, padR = 16, padT = 18, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const vals = points.flatMap((p) => [p.value, p.budget]).filter((v): v is number => v != null);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, max) * 0.985; // tighten so month-to-month change reads
  const span = max - min || 1;
  const x = (i: number) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - min) / span) * plotH;
  const line = points.map((p, i) => (p.value == null ? null : `${x(i)},${y(p.value)}`)).filter(Boolean).join(" ");
  const area = `${padL},${padT + plotH} ${line} ${x(points.length - 1)},${padT + plotH}`;
  const hasBudget = points.some((p) => p.budget != null);

  return (
    <div className="overflow-x-auto">
      {hasBudget && (
        <div className="mb-1 flex items-center gap-4 text-[11px]" style={{ color: MUTED }}>
          <span className="flex items-center gap-1.5"><span style={{ background: EMERALD }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Actual</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: BUDGET }} /> Budget</span>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 460 }} role="img" aria-label="Trend over time">
        {[0, 1].map((t) => { const gy = padT + plotH - t * plotH; return <g key={t}><line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke={GRID} strokeWidth={1} /><text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={10} fill={MUTED}>{moneyK(min + t * span)}</text></g>; })}
        <polygon points={area} fill={EMERALD} opacity={0.12} />
        {hasBudget && <polyline points={points.map((p, i) => (p.budget == null ? null : `${x(i)},${y(p.budget)}`)).filter(Boolean).join(" ")} fill="none" stroke={BUDGET} strokeWidth={2} strokeDasharray="4 3" />}
        <polyline points={line} fill="none" stroke={EMERALD} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => p.value == null ? null : (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={4} fill={EMERALD}
              onMouseEnter={() => setHover({ x: x(i), y: y(p.value!), rows: [p.label, moneyK(p.value!), ...(p.budget != null ? [`bdgt ${moneyK(p.budget)}`] : [])] })}
              onMouseLeave={() => setHover(null)}
              onTouchStart={() => setHover({ x: x(i), y: y(p.value!), rows: [p.label, moneyK(p.value!), ...(p.budget != null ? [`bdgt ${moneyK(p.budget)}`] : [])] })} />
            <text x={x(i)} y={H - padB + 15} textAnchor="middle" fontSize={11} fill={MUTED}>{p.label}</text>
          </g>
        ))}
        <Tip hover={hover} W={W} />
      </svg>
    </div>
  );
}

// ---- Forecast trend (solid history + dashed projection) --------------------
// Draws the historical book as a solid emerald area/line and the forward
// projection as a dashed emerald continuation, on one shared axis. Same green
// family as the other book panels; a faint divider marks "now".
export function ForecastTrend({
  historical,
  forecast,
  height = 220,
}: {
  historical: { label: string; value: number }[];
  forecast: { label: string; value: number }[];
  height?: number;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const W = 640, H = height, padL = 48, padR = 16, padT = 18, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // One continuous index space: history 0..h-1, forecast h..h+f-1.
  const h = historical.length, f = forecast.length;
  const combined = [
    ...historical.map((p) => ({ ...p, kind: "hist" as const })),
    ...forecast.map((p) => ({ ...p, kind: "fc" as const })),
  ];
  const total = combined.length;
  const vals = combined.map((p) => p.value);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, max) * 0.985; // tighten so change reads
  const span = max - min || 1;
  const x = (i: number) => padL + (total <= 1 ? plotW / 2 : (i / (total - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - min) / span) * plotH;

  const histLine = historical.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const histArea = h > 0 ? `${padL},${padT + plotH} ${histLine} ${x(h - 1)},${padT + plotH}` : "";
  // Forecast line starts at the last historical point so the dash continues.
  const fcLine = [
    ...(h > 0 ? [`${x(h - 1)},${y(historical[h - 1].value)}`] : []),
    ...forecast.map((p, i) => `${x(h + i)},${y(p.value)}`),
  ].join(" ");

  // Thin x-labels so ~18 points don't collide.
  const step = Math.max(1, Math.ceil(total / 9));

  return (
    <div className="overflow-x-auto">
      <div className="mb-1 flex items-center gap-4 text-[11px]" style={{ color: MUTED }}>
        <span className="flex items-center gap-1.5"><span style={{ background: EMERALD }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Actual book</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: EMERALD }} /> Projected (+12 mo)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 460 }} role="img" aria-label="Book value: history and 12-month projection">
        {[0, 1].map((t) => { const gy = padT + plotH - t * plotH; return <g key={t}><line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke={GRID} strokeWidth={1} /><text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={10} fill={MUTED}>{moneyK(min + t * span)}</text></g>; })}
        {histArea && <polygon points={histArea} fill={EMERALD} opacity={0.12} />}
        {h > 0 && f > 0 && <line x1={x(h - 1)} y1={padT} x2={x(h - 1)} y2={padT + plotH} stroke={GRID} strokeWidth={1} strokeDasharray="2 3" />}
        <polyline points={histLine} fill="none" stroke={EMERALD} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={fcLine} fill="none" stroke={EMERALD} strokeWidth={2.5} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
        {combined.map((p, i) => {
          const isFc = p.kind === "fc";
          const rows = [p.label, moneyK(p.value), ...(isFc ? ["projected"] : [])];
          const set = () => setHover({ x: x(i), y: y(p.value), rows });
          return (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.value)} r={isFc ? 3 : 4} fill={isFc ? "#f6fbf9" : EMERALD} stroke={EMERALD} strokeWidth={isFc ? 1.5 : 0}
                onMouseEnter={set} onMouseLeave={() => setHover(null)} onTouchStart={set} />
              {i % step === 0 || i === total - 1 ? (
                <text x={x(i)} y={H - padB + 15} textAnchor="middle" fontSize={10} fill={MUTED}>{p.label.replace(/ 20(\d\d)$/, " $1")}</text>
              ) : null}
            </g>
          );
        })}
        <Tip hover={hover} W={W} />
      </svg>
    </div>
  );
}

// ---- Budget vs actual + forward forecast -----------------------------------
// One category across the year: the ACTUAL as a solid emerald line + shaded
// area up to the latest posted month, and the BUDGET/target as a companion line
// — solid through the posted months, then DASHED for the forward months (the
// "forecasted targets going forward"). A faint divider marks "now". `actual` is
// null for months not yet posted. Mirrors the exec book-forecast look.
export function BudgetVsForecast({
  points,
  height = 200,
}: {
  points: { label: string; target: number | null; actual: number | null }[];
  height?: number;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const W = 640, H = height, padL = 48, padR = 16, padT = 18, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const total = points.length;

  const vals = points.flatMap((p) => [p.target, p.actual]).filter((v): v is number => v != null);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, max) * 0.9;
  const span = max - min || 1;
  const x = (i: number) => padL + (total <= 1 ? plotW / 2 : (i / (total - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - min) / span) * plotH;

  // Latest month with a posted actual = the "now" boundary.
  let lastA = -1;
  for (let i = 0; i < total; i++) if (points[i].actual != null) lastA = i;

  const actualPts = points.map((p, i) => ({ i, v: p.actual })).filter((p) => p.v != null) as { i: number; v: number }[];
  const actualLine = actualPts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");
  const actualArea = actualPts.length
    ? `${x(actualPts[0].i)},${padT + plotH} ${actualLine} ${x(actualPts[actualPts.length - 1].i)},${padT + plotH}`
    : "";

  // Budget: solid through the posted range, dashed for the forward range.
  const tgt = points.map((p, i) => ({ i, v: p.target })).filter((p) => p.v != null) as { i: number; v: number }[];
  const splitAt = lastA < 0 ? 0 : lastA;
  const budgetSolid = tgt.filter((p) => p.i <= splitAt).map((p) => `${x(p.i)},${y(p.v)}`).join(" ");
  const budgetDashed = tgt.filter((p) => p.i >= splitAt).map((p) => `${x(p.i)},${y(p.v)}`).join(" ");
  const step = Math.max(1, Math.ceil(total / 12));

  return (
    <div className="overflow-x-auto">
      <div className="mb-1 flex flex-wrap items-center gap-4 text-[11px]" style={{ color: MUTED }}>
        <span className="flex items-center gap-1.5"><span style={{ background: EMERALD }} className="inline-block h-2.5 w-2.5 rounded-sm" /> Actual</span>
        <span className="flex items-center gap-1.5"><span style={{ background: BUDGET }} className="inline-block h-0.5 w-3.5" /> Budget</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: BUDGET }} /> Budget (forecast ahead)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 460 }} role="img" aria-label="Budget vs actual with forward forecast">
        {[0, 1].map((t) => { const gy = padT + plotH - t * plotH; return <g key={t}><line x1={padL} y1={gy} x2={padL + plotW} y2={gy} stroke={GRID} strokeWidth={1} /><text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={10} fill={MUTED}>{moneyK(min + t * span)}</text></g>; })}
        {actualArea && <polygon points={actualArea} fill={EMERALD} opacity={0.12} />}
        {lastA >= 0 && lastA < total - 1 && <line x1={x(lastA)} y1={padT} x2={x(lastA)} y2={padT + plotH} stroke={GRID} strokeWidth={1} strokeDasharray="2 3" />}
        {budgetSolid && <polyline points={budgetSolid} fill="none" stroke={BUDGET} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {budgetDashed && <polyline points={budgetDashed} fill="none" stroke={BUDGET} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />}
        {actualLine && <polyline points={actualLine} fill="none" stroke={EMERALD} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => {
          const rows = [p.label, ...(p.actual != null ? [`Actual ${money0(p.actual)}`] : [`Budget ${p.target != null ? money0(p.target) : "—"} (forecast)`]), ...(p.actual != null && p.target != null ? [`Budget ${money0(p.target)}`] : [])];
          const cy = p.actual != null ? y(p.actual) : (p.target != null ? y(p.target) : padT + plotH);
          const set = () => setHover({ x: x(i), y: cy, rows });
          return (
            <g key={i}>
              {p.actual != null ? <circle cx={x(i)} cy={y(p.actual)} r={3.5} fill={EMERALD} onMouseEnter={set} onMouseLeave={() => setHover(null)} onTouchStart={set} /> : null}
              {p.actual == null && p.target != null ? <circle cx={x(i)} cy={y(p.target)} r={3} fill="#f6fbf9" stroke={BUDGET} strokeWidth={1.5} onMouseEnter={set} onMouseLeave={() => setHover(null)} onTouchStart={set} /> : null}
              {i % step === 0 || i === total - 1 ? <text x={x(i)} y={H - padB + 15} textAnchor="middle" fontSize={10} fill={MUTED}>{p.label}</text> : null}
            </g>
          );
        })}
        <Tip hover={hover} W={W} />
      </svg>
    </div>
  );
}

// ---- Donut -----------------------------------------------------------------
export function Donut({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: { label: string; value: number }[];
  centerLabel?: string;
  centerValue?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = 80, r = 50, cx = 100, cy = 100;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const frac = s.value / total;
    const a0 = angle, a1 = angle + frac * Math.PI * 2; angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
    const d = `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
    return { d, color: SERIES[i % SERIES.length], s, pct: Math.round(frac * 100) };
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 200 200" width="180" height="180" role="img" aria-label="Revenue mix">
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} stroke="#f6fbf9" strokeWidth={hover === i ? 3 : 2}
            opacity={hover == null || hover === i ? 1 : 0.55}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)} />
        ))}
        <text x={100} y={hover == null ? 98 : 94} textAnchor="middle" fontSize={hover == null ? 20 : 15} fontWeight={600} fill={INK}>
          {hover == null ? (centerValue ?? "") : money0(arcs[hover].s.value)}
        </text>
        <text x={100} y={hover == null ? 116 : 110} textAnchor="middle" fontSize={11} fill={MUTED}>
          {hover == null ? (centerLabel ?? "") : `${arcs[hover].s.label} · ${arcs[hover].pct}%`}
        </text>
      </svg>
      <ul className="flex-1 min-w-[150px] space-y-1.5">
        {arcs.map((a, i) => (
          <li key={i} className="flex items-center gap-2 text-sm" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="inline-block h-3 w-3 rounded-sm shrink-0" style={{ background: a.color }} />
            <span className="flex-1 truncate" style={{ color: INK }}>{a.s.label}</span>
            <span className="tabular-nums font-medium" style={{ color: INK }}>{a.pct}%</span>
            <span className="tabular-nums text-xs" style={{ color: MUTED }}>{money0(a.s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
