"use client";

// Shared client helpers + small presentational bits for the Groundwork UI
// (My Work · Huddles · The Greenhouse · Projects). Pure client module: it only
// imports TYPES from the server libs (erased at build) and the presentational
// Buzz mascot, so it never pulls server-only code into the bundle.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Buzz } from "@/components/Buzz";
import type { WorkItemDTO } from "@/lib/groundwork";

export type { WorkItemDTO } from "@/lib/groundwork";
export type { ProjectDTO } from "@/lib/groundwork";
export type { MeetingDTO, AgendaItemDTO, MeetingAttendeeDTO, MeetingNoteDTO } from "@/lib/huddles";
export type AssignablePerson = { id: string; name: string; email: string; branch: string | null; branchLabel: string | null };

// ── Fetch helpers ───────────────────────────────────────────────────────────

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data?.error as string) || "Something went wrong.");
  return data;
}

export const postGroundwork = (body: unknown) => postJson("/api/groundwork", body);
export const postProjects = (body: unknown) => postJson("/api/groundwork/projects", body);
export const postHuddle = (body: unknown) => postJson("/api/huddles", body);

export async function getJson<T = Record<string, unknown>>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(((data as Record<string, unknown>)?.error as string) || "Something went wrong.");
  return data;
}

export type SuggestSlot = { start: string; end: string; available: boolean; conflicts: string[] };
export type SuggestResult = {
  availabilityKnown: boolean;
  slots: SuggestSlot[];
  window: { earliest: string; latest: string; tz: string; durationMins: number };
};

export async function suggestTimes(body: {
  attendeeEmails: string[]; durationMins: number; earliest: string; latest: string;
}): Promise<SuggestResult> {
  const res = await fetch("/api/scheduling/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as SuggestResult & { error?: string };
  if (!res.ok) throw new Error(data?.error || "Couldn't suggest times.");
  return data;
}

// ── Formatters ──────────────────────────────────────────────────────────────

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** The value a <input type="date"> wants (YYYY-MM-DD) for an ISO date. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

// ── Priority + due chips (calm — only high/urgent carry color) ────────────────

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-red-50 text-red-700 ring-1 ring-red-200",
  high: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  normal: "bg-slate-100 text-slate-500",
  low: "bg-slate-50 text-slate-400",
};

export function PriorityChip({ priority }: { priority: string }) {
  // Normal/low are the quiet default — don't shout. Only surface high/urgent as a chip.
  if (priority !== "high" && priority !== "urgent") return null;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.normal}`}>
      {priority}
    </span>
  );
}

export function DueChip({ item, now = new Date() }: { item: WorkItemDTO; now?: Date }) {
  if (!item.dueDate) return null;
  const due = new Date(item.dueDate);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 864e5;
  const diffDays = Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() - startOfToday.getTime()) / dayMs);
  let label = fmtDay(item.dueDate);
  let cls = "text-muted";
  if (diffDays < 0) { label = `Overdue · ${fmtDay(item.dueDate)}`; cls = "text-red-600"; }
  else if (diffDays === 0) { label = "Due today"; cls = "text-brand-700 font-medium"; }
  else if (diffDays === 1) { label = "Due tomorrow"; cls = "text-ink"; }
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] ${cls}`}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
      </svg>
      {label}
    </span>
  );
}

// ── Satisfying, motion-safe check-off control ─────────────────────────────────

export function CheckOff({
  done, onToggle, label, busy = false,
}: { done: boolean; onToggle: () => void; label: string; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={done}
      aria-label={done ? `Mark "${label}" not done` : `Mark "${label}" done`}
      className={`group relative grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f6f5] disabled:opacity-50 ${
        done ? "border-brand-600 bg-emerald-grad text-white" : "border-[#c4d4ca] bg-white text-transparent hover:border-brand-500"
      }`}
    >
      <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform duration-150 ${done ? "scale-100" : "scale-0 group-hover:scale-75 group-hover:text-brand-400"}`} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 13l4 4L19 7" />
      </svg>
    </button>
  );
}

// ── Buzz celebration — a real, earned moment (cleared Today / closed follow-ups) ─

const BURST = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 4.6 + (i % 3) * 7) % 100,
  color: ["#1f9d57", "#edc14e", "#ef6186", "#3a8fe8", "#9b6cf0"][i % 5],
  delay: (i % 7) * 0.12,
  round: i % 2 === 0,
}));

export function BuzzCelebration({
  headline, sub, onDone,
}: { headline: string; sub?: string; onDone: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timer.current = setTimeout(onDone, 3200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [onDone]);
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[#08251899]/60 p-6 backdrop-blur-sm motion-safe:animate-[toast-in_200ms_ease-out]"
      role="status"
      aria-live="polite"
      onClick={onDone}
    >
      <div className="buzz-confetti pointer-events-none absolute inset-x-0 top-0 h-full" aria-hidden="true">
        {BURST.map((c, i) => (
          <i
            key={i}
            style={{
              left: `${c.left}%`,
              width: c.round ? "9px" : "7px",
              height: c.round ? "9px" : "13px",
              borderRadius: c.round ? "50%" : "2px",
              background: c.color,
              animationDelay: `${c.delay}s`,
            }}
          />
        ))}
      </div>
      <div className="relative max-w-xs rounded-2xl border border-line bg-white px-7 py-6 text-center shadow-2xl">
        <div className="mx-auto mb-1 h-28 w-28">
          <Buzz variant="plain" size={112} />
        </div>
        <p className="text-lg font-medium text-ink">{headline}</p>
        {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
      </div>
    </div>
  );
}

// ── Lightweight modal shell (focus-safe, Escape to close) ─────────────────────

export function Modal({
  title, onClose, children, wide = false,
}: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button");
    first?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" onClick={onClose} />
      <div
        ref={ref}
        className={`relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl motion-safe:animate-[toast-in_180ms_ease-out] sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-black/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Shared form field styling.
export const fieldClass = "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";
export const labelClass = "block text-xs font-medium text-muted mb-1";

export function useBool(initial = false): [boolean, () => void, (v: boolean) => void] {
  const [v, setV] = useState(initial);
  return [v, () => setV((x) => !x), setV];
}

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
