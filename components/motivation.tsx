import type { ReactNode } from "react";

/**
 * Motivation & progress primitives — the shared "make progress feel good" kit.
 *
 * Used across dashboards, scorecards, sales goals, training, and HR pipelines to
 * turn status into encouragement. On-brand per docs/BRAND_KIT.md: the "low→high"
 * ramp is a restrained warm-clay → amber → forest (NEVER neon), calm motion
 * (CSS width/stroke transitions that stop under prefers-reduced-motion), and the
 * forest/brand token palette. These are pure (no hooks) so they render in server
 * components; the interactive slider lives in components/GoalSlider.tsx.
 */

// ---------------------------------------------------------------------------
// Encouragement color ramp — warm (low) → forest/celebrate (high). Restrained
// saturation; reads as "keep climbing", not a traffic light.
// ---------------------------------------------------------------------------
const RAMP: [number, [number, number, number]][] = [
  [0.0, [181, 101, 77]], // #B5654D warm clay
  [0.4, [209, 161, 78]], // #D1A14E amber
  [0.7, [116, 169, 110]], // #74A96E brand-400
  [1.0, [31, 157, 87]], // #1F9D57 celebrate
];

export function rampColor(pct: number): string {
  const t = Math.max(0, Math.min(1, pct / 100));
  let lo = RAMP[0];
  let hi = RAMP[RAMP.length - 1];
  for (let i = 0; i < RAMP.length - 1; i++) {
    if (t >= RAMP[i][0] && t <= RAMP[i + 1][0]) {
      lo = RAMP[i];
      hi = RAMP[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const k = (t - lo[0]) / span;
  const c = (a: number, b: number) => Math.round(a + (b - a) * k);
  const [r, g, b] = [c(lo[1][0], hi[1][0]), c(lo[1][1], hi[1][1]), c(lo[1][2], hi[1][2])];
  return `rgb(${r}, ${g}, ${b})`;
}

/** An encouraging word for a given completion %. */
export function encouragement(pct: number): string {
  if (pct >= 100) return "Goal reached";
  if (pct >= 85) return "Almost there";
  if (pct >= 60) return "On track";
  if (pct >= 30) return "Building momentum";
  if (pct > 0) return "Off the mark";
  return "Let's go";
}

const CheckIcon = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M5 13l4 4L19 7" />
  </svg>
);

// ---------------------------------------------------------------------------
// AchievementBar — horizontal progress with the encouragement ramp + milestones.
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
  const color = tone === "ramp" ? rampColor(pct) : tone === "brand" ? "#2E6F47" : tone;
  const done = pct >= 100;
  const h = size === "sm" ? "h-2" : size === "lg" ? "h-3.5" : "h-2.5";
  return (
    <div className={className}>
      {(label || showPercent) && (
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          {label ? <span className="text-sm font-light text-ink">{label}</span> : <span />}
          {showPercent && (
            <span className="text-xs font-medium tabular-nums" style={{ color }}>
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}
      <div
        className={`relative ${h} rounded-full bg-black/[0.06] overflow-hidden`}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === "string" ? label : "progress"}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%`, background: done ? "linear-gradient(90deg,#2E6F47,#1F9D57)" : color }}
        />
        {milestones?.map((m) => (
          <span
            key={m.at}
            className="absolute top-1/2 -translate-y-1/2 h-1.5 w-0.5 rounded"
            style={{ left: `${Math.min(100, m.at)}%`, background: pct >= m.at ? "rgba(255,255,255,.7)" : "rgba(8,37,24,.18)" }}
            title={m.label}
          />
        ))}
      </div>
      {caption && <div className="mt-1 text-xs text-muted">{caption}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressRing — compact circular completion (stat tiles, completion %).
// ---------------------------------------------------------------------------
export function ProgressRing({
  value,
  target = 100,
  size = 64,
  stroke = 7,
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
  const color = tone === "ramp" ? rampColor(pct) : tone === "brand" ? "#2E6F47" : tone;
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
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute text-xs font-medium tabular-nums" style={{ color }}>
        {label ?? `${Math.round(pct)}%`}
      </span>
    </div>
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
        {/* track + progress line */}
        <div className="absolute left-0 right-0 top-3 h-0.5 bg-black/[0.08]" />
        <div className="absolute left-0 top-3 h-0.5 transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#74A96E,#1F9D57)" }} />
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
                    background: done ? "#2E6F47" : current ? "#1F9D57" : "rgba(8,37,24,.10)",
                    boxShadow: current ? "0 0 0 4px rgba(31,157,87,.18)" : undefined,
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
// KpiMeter — a scorecard KPI as actual-vs-target with met/attention coloring.
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
  const color = isMet ? "#2E6F47" : rampColor(pct);
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm font-light text-ink">{label}</span>
        <span className="text-xs tabular-nums text-muted">
          <span className="font-medium" style={{ color }}>{format(value)}</span> / {format(target)}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-black/[0.06] overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
        {/* target marker at 100% */}
        <span className="absolute top-0 bottom-0 w-0.5 bg-[rgba(8,37,24,.25)]" style={{ left: "71.4%" }} title="target" />
      </div>
    </div>
  );
}
