import type { ReactNode } from "react";

/**
 * Motivation & progress primitives — the shared "make progress feel good" kit.
 *
 * v2 (COO-approved 2026-10): a deliberately BOLD Signal ramp (red → amber → lime
 * → green) so attainment reads across the room, plus a speedometer Gauge and
 * larger default sizes. On-brand per docs/BRAND_KIT.md §12. Fills use the bright
 * hex; text uses darker ink variants for ≥4.5:1 on the light canvas. These are
 * pure (no hooks) so they render in server components; the interactive slider
 * lives in components/GoalSlider.tsx.
 */

// ---------------------------------------------------------------------------
// Signal ramp — bright fills (behind → watch → climbing → on/ahead).
// ---------------------------------------------------------------------------
const RAMP: [number, [number, number, number]][] = [
  [0.0, [229, 72, 77]], // #E5484D behind (red)
  [0.45, [246, 179, 24]], // #F6B318 watch (amber)
  [0.72, [134, 197, 64]], // #86C540 climbing (lime)
  [1.0, [21, 184, 92]], // #15B85C on / ahead (green)
];
// Darker text variants (readable on white): red / amber / green.
const RAMP_TEXT: [number, [number, number, number]][] = [
  [0.0, [196, 42, 47]], // #C42A2F
  [0.45, [143, 100, 0]], // #8F6400
  [0.72, [14, 122, 61]], // #0E7A3D
  [1.0, [14, 122, 61]], // #0E7A3D
];

function interp(ramp: [number, [number, number, number]][], pct: number): string {
  const t = Math.max(0, Math.min(1, pct / 100));
  let lo = ramp[0];
  let hi = ramp[ramp.length - 1];
  for (let i = 0; i < ramp.length - 1; i++) {
    if (t >= ramp[i][0] && t <= ramp[i + 1][0]) { lo = ramp[i]; hi = ramp[i + 1]; break; }
  }
  const span = hi[0] - lo[0] || 1;
  const k = (t - lo[0]) / span;
  const c = (a: number, b: number) => Math.round(a + (b - a) * k);
  return `rgb(${c(lo[1][0], hi[1][0])}, ${c(lo[1][1], hi[1][1])}, ${c(lo[1][2], hi[1][2])})`;
}

/** Bright FILL color for an attainment %. */
export function rampColor(pct: number): string {
  return interp(RAMP, pct);
}
/** Readable TEXT color for an attainment % (darker than the fill). */
export function rampTextColor(pct: number): string {
  return interp(RAMP_TEXT, pct);
}
/** Gradient for a completed/100% fill — forest → celebrate finish. */
const DONE_FILL = "linear-gradient(90deg,#15B85C,#1F9D57)";

/** An encouraging word for a given completion %. */
export function encouragement(pct: number): string {
  if (pct >= 100) return "Goal reached";
  if (pct >= 85) return "Almost there";
  if (pct >= 60) return "On track";
  if (pct >= 30) return "Building momentum";
  if (pct > 0) return "Getting started";
  return "Let's go";
}

const CheckIcon = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M5 13l4 4L19 7" />
  </svg>
);

// ---------------------------------------------------------------------------
// AchievementBar — bold horizontal attainment with the Signal ramp + milestones.
// ---------------------------------------------------------------------------
export function AchievementBar({
  value,
  target = 100,
  label,
  caption,
  showPercent = true,
  milestones,
  tone = "ramp",
  size = "md",
  className = "",
}: {
  value: number;
  target?: number;
  label?: ReactNode;
  caption?: ReactNode;
  showPercent?: boolean;
  milestones?: { at: number; label?: string }[];
  tone?: "ramp" | "brand" | string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const pct = target > 0 ? Math.max(0, Math.min(100, (value / target) * 100)) : 0;
  const fill = tone === "ramp" ? rampColor(pct) : tone === "brand" ? "#2E6F47" : tone;
  const textColor = tone === "ramp" ? rampTextColor(pct) : tone === "brand" ? "#1F5836" : tone;
  const done = pct >= 100;
  const h = size === "sm" ? "h-3" : size === "lg" ? "h-6" : "h-5";
  return (
    <div className={className}>
      {(label || showPercent) && (
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          {label ? <span className="text-sm font-light text-ink">{label}</span> : <span />}
          {showPercent && (
            <span className="text-lg font-semibold tabular-nums leading-none" style={{ color: textColor }}>
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}
      <div
        className={`relative ${h} rounded-full bg-black/[0.08] overflow-hidden`}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === "string" ? label : "progress"}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{
            width: `${pct}%`,
            background: done ? DONE_FILL : fill,
            boxShadow: pct > 0 ? `0 0 10px -1px ${fill}66` : undefined,
          }}
        >
          {/* subtle gloss */}
          <div className="h-1/2 rounded-t-full" style={{ background: "linear-gradient(180deg,rgba(255,255,255,.35),transparent)" }} />
        </div>
        {milestones?.map((m) => (
          <span
            key={m.at}
            className="absolute top-1/2 -translate-y-1/2 h-2.5 w-0.5 rounded"
            style={{ left: `${Math.min(100, m.at)}%`, background: pct >= m.at ? "rgba(255,255,255,.85)" : "rgba(8,37,24,.22)" }}
            title={m.label}
          />
        ))}
      </div>
      {caption && <div className="mt-1 text-xs text-muted">{caption}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressRing — bold circular completion (stat tiles, completion %).
// ---------------------------------------------------------------------------
export function ProgressRing({
  value,
  target = 100,
  size = 96,
  stroke = 12,
  tone = "ramp",
  label,
}: {
  value: number;
  target?: number;
  size?: number;
  stroke?: number;
  tone?: "ramp" | "brand" | string;
  label?: ReactNode;
}) {
  const pct = target > 0 ? Math.max(0, Math.min(100, (value / target) * 100)) : 0;
  const fill = tone === "ramp" ? rampColor(pct) : tone === "brand" ? "#2E6F47" : tone;
  const textColor = tone === "ramp" ? rampTextColor(pct) : tone === "brand" ? "#1F5836" : tone;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(8,37,24,.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={fill}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute font-semibold tabular-nums" style={{ color: textColor, fontSize: Math.max(13, size * 0.24) }}>
        {label ?? `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gauge — a speedometer dial (red → amber → green arc + needle + target tick).
// The headline component for a single KPI the eye should land on first.
// ---------------------------------------------------------------------------
export function Gauge({
  value,
  target = 100,
  size = 200,
  label,
  format = (n) => `${Math.round(n)}%`,
  showStatus = true,
}: {
  value: number;
  target?: number;
  size?: number;
  label?: ReactNode;
  format?: (pct: number) => string;
  showStatus?: boolean;
}) {
  const pct = target > 0 ? Math.max(0, Math.min(120, (value / target) * 100)) : 0;
  const shown = Math.min(100, pct);
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = size * 0.56;
  const radius = size * 0.42;
  const stroke = Math.max(10, size * 0.07);
  // Map 0..100% to 180°(left)..0°(right). Angle in radians for a point on the arc.
  const ang = (p: number) => Math.PI - (Math.min(100, Math.max(0, p)) / 100) * Math.PI;
  const pt = (p: number, rr = radius) => [cx + rr * Math.cos(ang(p)), cy - rr * Math.sin(ang(p))];
  // Build the colored arc in segments so it shifts red→amber→green along the dial.
  const SEGMENTS = 48;
  const arc: ReactNode[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const p0 = (i / SEGMENTS) * 100;
    const p1 = ((i + 1) / SEGMENTS) * 100;
    const [x0, y0] = pt(p0);
    const [x1, y1] = pt(p1);
    const lit = shown >= p1 - 0.01;
    arc.push(
      <path
        key={i}
        d={`M ${x0} ${y0} A ${radius} ${radius} 0 0 1 ${x1} ${y1}`}
        fill="none"
        stroke={lit ? rampColor((p0 + p1) / 2) : "rgba(8,37,24,.08)"}
        strokeWidth={stroke}
        strokeLinecap="butt"
      />,
    );
  }
  const [nx, ny] = pt(shown, radius - stroke);
  const [tx, ty] = pt(100, radius + stroke * 0.2);
  const textColor = rampTextColor(Math.min(100, pct));
  const met = pct >= 100;
  return (
    <div className="inline-grid place-items-center" style={{ width: w }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {arc}
        {/* target tick at 100% */}
        <circle cx={tx} cy={ty} r={Math.max(2, size * 0.016)} fill="rgba(8,37,24,.55)" />
        {/* needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={rampColor(Math.min(100, pct))} strokeWidth={Math.max(3, size * 0.02)} strokeLinecap="round"
          className="transition-all duration-700 ease-out motion-reduce:transition-none" style={{ transformOrigin: `${cx}px ${cy}px` }} />
        <circle cx={cx} cy={cy} r={Math.max(5, size * 0.045)} fill="#1D2A23" />
      </svg>
      <div className="-mt-1 text-center">
        <div className="font-semibold tabular-nums leading-none" style={{ color: textColor, fontSize: size * 0.17 }}>{format(pct)}</div>
        {label && <div className="mt-1 text-xs text-muted">{label}</div>}
        {showStatus && (
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: met ? "#0E7A3D" : textColor }}>{encouragement(pct)}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreakFlame — a consecutive-period streak badge (sanctioned motivator).
// ---------------------------------------------------------------------------
export function StreakFlame({ count, label, className = "" }: { count: number; label?: string; className?: string }) {
  const hot = count >= 3;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ${className}`}
      style={{ background: hot ? "rgba(246,179,24,.14)" : "rgba(8,37,24,.05)", color: hot ? "#8F6400" : "#5C6B62" }}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={hot ? "#F6B318" : "#9bb0a4"} aria-hidden>
        <path d="M12 2c2 3 5 5 5 9a5 5 0 01-10 0c0-1 .3-1.8.8-2.6C8 9.8 9 11 10 11c-.5-2 .5-5 2-9z" />
      </svg>
      <span className="tabular-nums">{count}</span>
      {label && <span className="font-light text-muted">{label}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MilestoneStepper — a journey as connected nodes (HR pipeline, onboarding,
// certification steps). Shows done / current / upcoming and overall progress.
// ---------------------------------------------------------------------------
export type Step = { label: string; state: "done" | "current" | "todo"; hint?: string };

export function MilestoneStepper({ steps, className = "" }: { steps: Step[]; className?: string }) {
  const doneCount = steps.filter((s) => s.state === "done").length;
  const currentIdx = steps.findIndex((s) => s.state === "current");
  const reached = currentIdx === -1 ? doneCount : currentIdx;
  const pct = steps.length > 1 ? (reached / (steps.length - 1)) * 100 : 0;
  return (
    <div className={className}>
      <div className="relative">
        <div className="absolute left-0 right-0 top-3 h-0.5 bg-black/[0.08]" />
        <div className="absolute left-0 top-3 h-0.5 transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#86C540,#15B85C)" }} />
        <ol className="relative flex justify-between">
          {steps.map((s, i) => {
            const done = s.state === "done";
            const current = s.state === "current";
            return (
              <li key={i} className="flex flex-col items-center gap-1.5" style={{ flex: "1 1 0" }}>
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ring-2 ring-[var(--canvas,#f4f6f5)] ${
                    done ? "text-white" : current ? "text-white" : "text-muted"
                  }`}
                  style={{
                    background: done ? "#15B85C" : current ? "#1F9D57" : "rgba(8,37,24,.10)",
                    boxShadow: current ? "0 0 0 4px rgba(31,157,87,.22)" : undefined,
                  }}
                >
                  {done ? <CheckIcon /> : i + 1}
                </span>
                <span className={`text-center text-[11px] leading-tight ${current ? "font-medium text-ink" : "text-muted"}`}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KpiMeter — a scorecard KPI as actual-vs-target with a clear target marker.
// ---------------------------------------------------------------------------
export function KpiMeter({
  label,
  value,
  target,
  met,
  format = (n) => `${n}`,
  className = "",
}: {
  label: ReactNode;
  value: number;
  target: number;
  met?: boolean;
  format?: (n: number) => string;
  className?: string;
}) {
  const pct = target > 0 ? Math.max(0, Math.min(140, (value / target) * 100)) : 0;
  const isMet = met ?? value >= target;
  const fill = isMet ? "#15B85C" : rampColor(pct);
  const textColor = isMet ? "#0E7A3D" : rampTextColor(pct);
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm font-light text-ink">{label}</span>
        <span className="text-xs tabular-nums text-muted">
          <span className="font-semibold" style={{ color: textColor }}>{format(value)}</span> / {format(target)}
        </span>
      </div>
      <div className="relative h-3.5 rounded-full bg-black/[0.08] overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${Math.min(100, pct)}%`, background: fill }} />
        {/* target marker at 100% (71.4% of the 0–140 track) — full opacity, 2px */}
        <span className="absolute top-0 bottom-0 w-[2px] bg-[#1D2A23]" style={{ left: "71.4%" }} title="target" />
      </div>
    </div>
  );
}
