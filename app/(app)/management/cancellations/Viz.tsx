"use client";

// Cancellation Center chart kit — dashboard-style panels with vertical column
// charts (optionally stacked) and a donut. Every mark is clickable (drills the
// whole dashboard) and has a hover tooltip; text stays in ink tokens, color only
// carries identity (division / reason) or a single-hue magnitude.

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Width of an element, tracked with ResizeObserver (charts draw at true pixel size). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w || fallback] as const;
}

const INK = "#1d2a23";
const MUTED = "#5c6b62";
const GRID = "#e6ebe8";
const BAR_ON = "#0b3d20";
const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const short$ = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : `$${Math.round(n)}`);

export function Panel({ title, subtitle, action, className = "", children }: { title: string; subtitle?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`@container flex min-w-0 flex-col rounded-xl border border-line bg-white ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-ink">{title}</h2>
          {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

type Tip = { x: number; y: number; lines: string[] } | null;
function TipBox({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div role="tooltip" className="pointer-events-none absolute z-20 w-max max-w-[240px] -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink shadow-lg"
      style={{ left: `${tip.x}%`, top: tip.y - 8 }}>
      <div className="font-medium">{tip.lines[0]}</div>
      {tip.lines.slice(1).map((l, i) => <div key={i} className={i === tip.lines.length - 2 ? "mt-1 text-brand-700" : "tabular-nums"}>{l}</div>)}
    </div>
  );
}

export type Segment = { key: string; label: string; value: number; count: number; color: string };
export type Column = { key: string; label: string; sub?: string; segments: Segment[]; active?: boolean };

/** Vertical column chart; stacked when a column has more than one segment. */
export function ColumnChart({
  columns, onColumn, onSegment, height = 230, legend, empty = "Nothing to show.", total,
}: {
  columns: Column[];
  onColumn?: (key: string) => void;
  onSegment?: (col: string, seg: string) => void;
  height?: number;
  legend?: { key: string; label: string; color: string }[];
  empty?: string;
  total?: number; // for "% of total" in tooltips
}) {
  const [tip, setTip] = useState<Tip>(null);
  const [ref, measured] = useWidth<HTMLDivElement>(560);
  if (!columns.length) return <p className="py-10 text-center text-sm text-muted">{empty}</p>;
  const n = columns.length;
  const W = Math.max(measured, n * 34), H = height, padT = 22, padB = 34, padX = 6;
  const plotH = H - padT - padB;
  const sums = columns.map((c) => c.segments.reduce((s, x) => s + x.value, 0));
  const max = Math.max(...sums, 1);
  const slot = (W - padX * 2) / n;
  const bw = Math.min(44, slot * 0.62);
  const y = (v: number) => (v / max) * plotH;
  const all = total ?? sums.reduce((a, b) => a + b, 0);
  return (
    <div ref={ref} className="relative overflow-x-auto" onMouseLeave={() => setTip(null)}>
      {legend && legend.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {legend.map((l) => <span key={l.key} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />{l.label}</span>)}
        </div>
      ) : null}
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Column chart" className="block overflow-visible">
        {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={padX} x2={W - padX} y1={padT + plotH - plotH * g} y2={padT + plotH - plotH * g} stroke={GRID} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        <line x1={padX} x2={W - padX} y1={padT + plotH} y2={padT + plotH} stroke="#cfd6d2" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {columns.map((c, i) => {
          const cx = padX + slot * i + slot / 2;
          let acc = 0;
          const sum = sums[i];
          const single = c.segments.length === 1;
          return (
            <g key={c.key}>
              {/* generous hit target for the whole column */}
              <rect x={cx - slot / 2} y={padT} width={slot} height={plotH + padB} fill="transparent" className={onColumn ? "cursor-pointer" : ""}
                onClick={() => onColumn?.(c.key)}
                onMouseMove={() => setTip({ x: (cx / W) * 100, y: padT + plotH - y(sum), lines: [c.label + (c.sub ? ` · ${c.sub}` : ""), `${money0(sum)} · ${c.segments.reduce((s, x) => s + x.count, 0)} services`, `${Math.round((sum / Math.max(1, all)) * 100)}% of the total`, onColumn ? "Click to drill in" : ""].filter(Boolean) })} />
              {c.segments.map((s, si) => {
                const h = y(s.value);
                const top = padT + plotH - acc - h;
                acc += h;
                const isTop = si === c.segments.length - 1;
                return (
                  <path key={s.key}
                    d={roundedTop(cx - bw / 2, top, bw, Math.max(h - (isTop ? 0 : 1.5), 0.5), isTop ? 4 : 0)}
                    fill={single ? (c.active ? BAR_ON : s.color) : s.color}
                    opacity={columns.some((x) => x.active) && !c.active ? 0.45 : 1}
                    className={onSegment || onColumn ? "cursor-pointer" : ""}
                    onClick={(e) => { e.stopPropagation(); if (onSegment && !single) onSegment(c.key, s.key); else onColumn?.(c.key); }}
                    onMouseMove={(e) => { e.stopPropagation(); setTip({ x: (cx / W) * 100, y: top, lines: [single ? c.label : `${c.label} · ${s.label}`, `${money0(s.value)} · ${s.count} service${s.count === 1 ? "" : "s"}`, `${Math.round((s.value / Math.max(1, sum)) * 100)}% of ${c.label}`, onSegment && !single ? "Click to filter to these" : onColumn ? "Click to drill in" : ""].filter(Boolean) }); }}
                  />
                );
              })}
              <text pointerEvents="none" x={cx} y={padT + plotH - acc - 6} textAnchor="middle" fontSize={slot < 45 ? 9.5 : 11} fill={INK} style={{ fontVariantNumeric: "tabular-nums" }}>{short$(sum)}</text>
              <text pointerEvents="none" x={cx} y={H - padB + 15} textAnchor="middle" fontSize={slot < 60 ? 10 : 11} fill={c.active ? INK : MUTED} fontWeight={c.active ? 600 : 400}>{trunc(c.label, Math.max(4, Math.floor(slot / (slot < 60 ? 5.4 : 6.4))))}</text>
              {c.sub ? <text pointerEvents="none" x={cx} y={H - padB + 28} textAnchor="middle" fontSize={9.5} fill={MUTED}>{trunc(c.sub, Math.max(4, Math.floor(slot / 5.8)))}</text> : null}
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export type Slice = { key: string; label: string; value: number; count: number; color: string; active?: boolean };

/** Donut with a clickable legend (label · share · $ · count). */
export function DonutChart({ slices, onSlice, centerLabel = "lost value" }: { slices: Slice[]; onSlice?: (key: string) => void; centerLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <p className="py-10 text-center text-sm text-muted">Nothing to show.</p>;
  const R = 74, r = 48, cx = 90, cy = 90;
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((a, x) => a + x.value, 0) / total);
  const anyActive = slices.some((s) => s.active);
  const h = hover != null ? slices[hover] : null;
  return (
    <div className="flex flex-col items-center gap-3 @md:flex-row @md:items-center">
      <svg viewBox="0 0 180 180" width="168" height="168" role="img" aria-label="Donut chart" className="shrink-0">
        {slices.map((s, i) => {
          const frac = s.value / total;
          const a0 = -Math.PI / 2 + starts[i] * Math.PI * 2;
          const a1 = a0 + Math.min(frac, 0.9999) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const p = (rad: number, ang: number) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
          const d = `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
          return (
            <path key={s.key} d={d} fill={s.color} stroke="#ffffff" strokeWidth={2}
              opacity={(anyActive && !s.active) || (hover != null && hover !== i) ? 0.45 : 1}
              className={onSlice ? "cursor-pointer" : ""}
              onClick={() => onSlice?.(s.key)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
        })}
        <text x={cx} y={h ? 86 : 90} textAnchor="middle" fontSize={h ? 15 : 17} fill={INK}>{money0(h ? h.value : total)}</text>
        <text x={cx} y={h ? 103 : 107} textAnchor="middle" fontSize={10} fill={MUTED}>{h ? `${Math.round((h.value / total) * 100)}% · ${h.count} svcs` : centerLabel}</text>
      </svg>
      <ul className="w-full min-w-0 space-y-0.5">
        {slices.map((s, i) => (
          <li key={s.key}>
            <button type="button" onClick={() => onSlice?.(s.key)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-brand-50 ${s.active ? "bg-brand-50 ring-1 ring-brand-300" : ""}`}>
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
              <span className="tabular-nums text-ink">{Math.round((s.value / total) * 100)}%</span>
              <span className="w-[64px] text-right tabular-nums text-muted">{money0(s.value)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
