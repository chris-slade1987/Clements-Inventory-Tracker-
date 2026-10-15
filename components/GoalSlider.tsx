"use client";

import { useState } from "react";
import { rampColor, encouragement } from "@/components/motivation";

/**
 * GoalSlider — a draggable goal control (motivation kit). Instead of typing a
 * number into a box, the user drags to set a goal; the fill + thumb shift along
 * the encouragement ramp (warm → forest) as the goal rises, with a live word of
 * encouragement. Controlled: pass `value` + `onChange`. On-brand per
 * docs/BRAND_KIT.md. Styling lives in `.goal-slider` (app/globals.css).
 */
export function GoalSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  format = (n) => `${n}`,
  // where along min→max the color ramp maxes out (e.g. a "stretch" goal)
  rampCeiling,
  hint = true,
  id,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  format?: (n: number) => string;
  rampCeiling?: number;
  hint?: boolean;
  id?: string;
}) {
  const [v, setV] = useState(value);
  const cur = v;
  const span = (rampCeiling ?? max) - min || 1;
  const rampPct = Math.max(0, Math.min(100, ((cur - min) / span) * 100));
  const trackPct = Math.max(0, Math.min(100, ((cur - min) / (max - min || 1)) * 100));
  const color = rampColor(rampPct);

  return (
    <div>
      {(label || hint) && (
        <div className="flex items-baseline justify-between gap-3 mb-2">
          {label ? <label htmlFor={id} className="text-sm font-light text-ink">{label}</label> : <span />}
          <span className="text-right">
            <span className="text-lg font-medium tabular-nums" style={{ color }}>{format(cur)}</span>
            {hint && <span className="ml-2 text-xs text-muted">{encouragement(rampPct)}</span>}
          </span>
        </div>
      )}
      <input
        id={id}
        type="range"
        className="goal-slider"
        min={min}
        max={max}
        step={step}
        value={cur}
        style={{ ["--pct" as string]: `${trackPct}%`, ["--accent" as string]: color }}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          onChange(n);
        }}
        aria-label={label}
        aria-valuetext={format(cur)}
      />
    </div>
  );
}

export default GoalSlider;
