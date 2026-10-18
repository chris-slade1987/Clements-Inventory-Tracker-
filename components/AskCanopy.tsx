"use client";

import { COPILOT_OPEN_EVENT, type CopilotOpenDetail } from "@/lib/copilot/prompts";

// A small, reusable inline entry-point into the Canopy Copilot. Drop it next to a
// workflow (the weekly checklist, a scorecard, a write-up form) to open the docked
// panel primed with a relevant starter question. It talks to the panel through a
// window CustomEvent (see COPILOT_OPEN_EVENT), so it needs no shared provider and
// works anywhere in the tree — including inside server components, since this is a
// client component.

/** Fire the open-and-prime event. Safe to call from any client handler. */
export function openCanopy(detail: CopilotOpenDetail): void {
  try {
    window.dispatchEvent(new CustomEvent<CopilotOpenDetail>(COPILOT_OPEN_EVENT, { detail }));
  } catch {
    /* no window (SSR) or event blocked — nothing to do */
  }
}

export default function AskCanopy({
  task,
  label = "Ask Canopy",
  context,
  send = false,
  variant = "link",
  className = "",
}: {
  /** The starter question the composer is primed with. */
  task: string;
  /** The visible button text. */
  label?: string;
  /** Optional on-screen context appended to the prompt (e.g. an employee name). */
  context?: string;
  /** Send immediately instead of only priming the box. Default: just prime. */
  send?: boolean;
  /** Visual treatment. `link` is a quiet inline pill; `button` is a bordered chip. */
  variant?: "link" | "button";
  className?: string;
}) {
  const prompt = context ? `${task}\n\n(Context: ${context})` : task;

  const base =
    "inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f6f5]";
  const look =
    variant === "button"
      ? "border border-[#cfe0d6] bg-white px-3 py-1.5 text-brand-700 hover:bg-[#eef5f0]"
      : "px-2 py-1 text-brand-700 hover:text-brand-800 hover:bg-[#eef5f0]";

  return (
    <button
      type="button"
      onClick={() => openCanopy({ prompt, send })}
      className={`${base} ${look} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 11.5a8 8 0 01-11.8 7L3 20l1.5-5.5A8 8 0 1121 11.5z" />
        <path d="M12 7.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
      </svg>
      {label}
    </button>
  );
}
