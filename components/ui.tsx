import type { ReactNode, HTMLAttributes } from "react";
import Link from "next/link";
import { UNITS_OF_MEASURE } from "@/lib/uom";

// The shared Toast primitive lives in its own "use client" module; re-export it
// here so screens import toasts from the same place as the other UI primitives.
export { ToastProvider, useToast } from "./Toast";
export type { Toast, ToastTone } from "./Toast";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-light tracking-tight text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-sm text-muted mt-1">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`surface-light rounded-xl border border-line bg-card-grad shadow-[0_1px_2px_rgba(8,37,24,0.04),0_14px_30px_-22px_rgba(8,37,24,0.5)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-8 text-center">
      {icon ? (
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
          {icon}
        </div>
      ) : null}
      <div className="font-medium text-ink">{title}</div>
      {hint ? <div className="text-sm text-muted mt-1">{hint}</div> : null}
    </Card>
  );
}

/**
 * Controlled unit-of-measure dropdown. THE only way a unit is chosen anywhere in
 * the app — options come from the canonical UNITS_OF_MEASURE table, so the value
 * is always a canonical code and never free text.
 */
export function UnitSelect({
  value,
  onChange,
  className = "",
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  id?: string;
}) {
  const hasValue = UNITS_OF_MEASURE.some((u) => u.code === value);
  return (
    <select
      id={id}
      value={hasValue ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      className={className || "w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"}
    >
      {hasValue ? null : <option value="">— Select unit —</option>}
      {UNITS_OF_MEASURE.map((u) => (
        <option key={u.code} value={u.code}>
          {u.label} ({u.code})
        </option>
      ))}
    </select>
  );
}

/** Reusable className strings for buttons so every screen matches. Each carries a
 *  keyboard focus ring (focus-visible only, so mouse clicks stay clean) for
 *  WCAG 2.4.7 — see the global :focus-visible fallback in app/globals.css. */
export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-black/10 hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition-[filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f6f5]",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f6f5]",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f6f5]",
};

/**
 * Low-chrome loading spinner (CanopyOS). A thin brand-green ring that spins; the
 * animation stops under prefers-reduced-motion (handled globally). Pair with a
 * label for screen readers via the `label` prop.
 */
export function Spinner({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5 animate-spin text-brand-600"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="text-sm text-muted">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

/**
 * A single shimmering placeholder block for loading skeletons. Compose several
 * to mirror a page's layout. Decorative: hidden from assistive tech (wrap the
 * group in an aria-busy region if you need a status).
 */
export function Skeleton({
  className = "",
  rounded = "rounded-lg",
}: {
  className?: string;
  /** Tailwind radius utility; defaults to the 12-ish card radius. */
  rounded?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block bg-black/[0.06] motion-safe:animate-pulse ${rounded} ${className}`}
    />
  );
}

/**
 * Standard card-and-tiles page skeleton used by the section loading.tsx files so
 * every heavy route shows the same branded shimmer instead of a frozen blank.
 */
export function PageSkeleton({
  tiles = 4,
  rows = 3,
}: {
  tiles?: number;
  rows?: number;
}) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-5">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {tiles > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: tiles }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-24" />
            </Card>
          ))}
        </div>
      ) : null}
      <Card className="p-5">
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10" rounded="rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * A back link for detail / edit / new routes — a left chevron + label in the
 * muted scheme. Shared so every screen's "back" affordance looks the same
 * (replaces the ad-hoc inline back links scattered across pages).
 */
export function BackLink({
  href,
  children = "Back",
  className = "",
}: {
  href: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {children}
    </Link>
  );
}

export type Crumb = { href?: string; label: string };

/**
 * Optional breadcrumb trail for deep routes. Pass an ordered list; the last item
 * renders as the current page (no link). Uses a nav/ol with aria-current.
 */
export function Breadcrumbs({
  items,
  className = "",
}: {
  items: Crumb[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={`text-sm text-muted ${className}`}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="inline-flex items-center gap-1.5">
              {i > 0 ? (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-muted/60" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              ) : null}
              {last || !c.href ? (
                <span aria-current={last ? "page" : undefined} className={last ? "text-ink" : undefined}>
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="hover:text-ink rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
