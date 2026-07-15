"use client";

import { useRef } from "react";

// Shared date field used across the app. Shows a visible calendar icon inside
// the box and opens the native date picker when you click anywhere in the
// field (or the icon) — not just the tiny default browser indicator.
export default function DateInput({
  value,
  onChange,
  className = "",
  inputClassName = "",
  min,
  max,
  name,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Layout classes for the wrapper (e.g. "mt-1 w-full"). */
  className?: string;
  /** Extra classes appended to the input (rarely needed). */
  inputClassName?: string;
  min?: string;
  max?: string;
  name?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const open = () => {
    if (disabled) return;
    const el = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    try { el?.showPicker?.(); } catch { /* unsupported / no gesture — ignore */ }
  };
  return (
    <div className={`relative ${className}`}>
      <input
        ref={ref}
        type="date"
        name={name}
        min={min}
        max={max}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={open}
        className={`date-clean w-full cursor-pointer rounded-lg border border-line px-3 py-2.5 pr-10 text-sm text-ink disabled:cursor-default disabled:opacity-70 ${inputClassName}`}
      />
      <button
        type="button"
        onClick={open}
        aria-label="Open calendar"
        tabIndex={-1}
        disabled={disabled}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-brand-600 hover:text-brand-700 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
