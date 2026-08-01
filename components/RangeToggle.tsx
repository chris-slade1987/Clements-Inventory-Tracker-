"use client";

import DateInput from "@/components/DateInput";
import { FUEL_RANGE_MODES, fmtRangeDate, isoDay, type FuelRangeMode } from "@/lib/fuel-format";

/**
 * Presentational date-range switch (Last 30 days / Last month / Last quarter /
 * Custom). State is owned by the parent; this just renders the pills, the custom
 * calendar inputs, and the resolved range label.
 */
export default function RangeToggle({
  mode,
  onMode,
  customStart,
  customEnd,
  onCustomStart,
  onCustomEnd,
  start,
  end,
}: {
  mode: FuelRangeMode;
  onMode: (m: FuelRangeMode) => void;
  customStart: string;
  customEnd: string;
  onCustomStart: (v: string) => void;
  onCustomEnd: (v: string) => void;
  start: Date;
  end: Date;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {FUEL_RANGE_MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => onMode(m.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === m.key ? "bg-emerald-grad text-white shadow-sm" : "bg-black/[0.04] text-muted hover:text-ink"
            }`}
          >
            {m.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted">{fmtRangeDate(isoDay(start))} – {fmtRangeDate(isoDay(end))}</span>
      </div>
      {mode === "custom" ? (
        <div className="pt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-muted">From
            <DateInput className="mt-1" value={customStart} onChange={onCustomStart} max={customEnd || undefined} />
          </label>
          <label className="text-xs font-medium text-muted">To
            <DateInput className="mt-1" value={customEnd} onChange={onCustomEnd} min={customStart || undefined} />
          </label>
        </div>
      ) : null}
    </div>
  );
}
