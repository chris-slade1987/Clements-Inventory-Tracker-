"use client";

// "What is this number?" affordance (CanopyOS vision Theme 1 — Single Source of
// Truth). A small, keyboard-accessible info button that opens a popover showing a
// metric's canonical definition, source and owner from lib/metrics-registry.ts,
// so every dashboard tile can answer "what is this number and where does it come
// from" without anyone arguing over whose spreadsheet is right.
//
// Brand-compliant: thin 1.6 line "info" glyph (small circle + i), currentColor,
// no fill; forest chrome + light canvas tokens; Helvetica Neue weight 300. No
// emoji. Accessible: focusable trigger, aria-wired dialog, Escape to close,
// click-outside to close, focus returns to the trigger. Honors
// prefers-reduced-motion (transitions are motion-safe only).

import { useEffect, useId, useRef, useState } from "react";
import { getMetric, unitLabel, type MetricDefinition } from "@/lib/metrics-registry";

type Props = {
  /** Registry key to resolve (preferred). */
  metricKey?: string;
  /** Or pass a definition directly (e.g. for an ad-hoc number not in the registry). */
  metric?: MetricDefinition | null;
  /** Visually-hidden context added to the trigger's accessible name. */
  srHint?: string;
  className?: string;
};

export default function MetricInfo({ metricKey, metric, srHint, className = "" }: Props) {
  const def = metric ?? getMetric(metricKey);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  // Close on outside click + Escape; restore focus to the trigger on Escape.
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!def) return null;

  const label = `What is this number? ${def.name}${srHint ? ` (${srHint})` : ""}`;

  return (
    <span ref={wrapRef} className={`relative inline-flex ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#f4f6f5]"
      >
        {/* Thin 1.6 line "info" glyph: circle + i, currentColor, no fill. */}
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={`${def.name} — definition`}
          className="absolute right-0 top-6 z-30 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-3.5 text-left shadow-[0_1px_2px_rgba(8,37,24,0.04),0_14px_30px_-18px_rgba(8,37,24,0.55)] motion-safe:animate-[toast-in_150ms_ease-out]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-medium text-ink">{def.name}</div>
            {def.canonical ? (
              <span className="shrink-0 rounded-full bg-brand-50 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-brand-700">
                canonical
              </span>
            ) : null}
          </div>

          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink/90">{def.definition}</p>

          <dl className="mt-3 space-y-2 border-t border-line pt-2.5 text-[11.5px] leading-relaxed">
            <Row term="Source" detail={def.source} />
            <Row term="Owner" detail={def.owner} />
            <Row
              term="Unit"
              detail={`${unitLabel(def.unit)} · ${def.format}`}
            />
            {def.window ? <Row term="Window" detail={def.window} /> : null}
            {def.distinction ? <Row term="How it differs" detail={def.distinction} /> : null}
          </dl>
        </div>
      ) : null}
    </span>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{term}</dt>
      <dd className="mt-0.5 text-ink/80">{detail}</dd>
    </div>
  );
}
