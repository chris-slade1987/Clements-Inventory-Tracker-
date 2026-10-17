import Link from "next/link";
import type { RhythmSegment, RhythmStatus } from "@/lib/rhythm";

// Operating-rhythm ribbon (CanopyOS Theme 3). A compact, phone-first
// "Today · This week · This month · This quarter" strip that makes the company
// operating cadence explicit per role. Brand kit: forest-green chrome accents on
// the light canvas, Helvetica Neue 300 headings, thin 1.6 line icons, no emoji.
// Display-only (server component) — all data is prepared by the role page.

// Status → a small dot color. Semantic colors are used ONLY for status, never as
// an accent (brand kit §3).
const DOT: Record<RhythmStatus, string> = {
  done: "bg-brand-500",
  due: "bg-amber-500",
  overdue: "bg-red-500",
  info: "bg-brand-300",
};

const CHECK = "M20 6L9 17l-5-5";

function HorizonIcon({ horizon }: { horizon: RhythmSegment["horizon"] }) {
  // Distinct thin-line glyph per horizon: sun (today), week grid, calendar
  // (month), quarter chart.
  const d =
    horizon === "today"
      ? "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7l1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2l-1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z"
      : horizon === "week"
        ? "M4 7h16M4 12h16M4 17h10M7 4v3m10-3v3"
        : horizon === "month"
          ? "M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z"
          : "M4 20V10m6 10V4m6 16v-7M4 20h16";
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function RowBody({ item }: { item: RhythmSegment["items"][number] }) {
  return (
    <span className="flex items-center gap-2">
      {item.status === "done" ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-brand-600" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={CHECK} />
        </svg>
      ) : (
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[item.status]}`} aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.label}</span>
      {item.meta ? (
        <span className={`shrink-0 text-[11px] font-medium tabular-nums ${item.status === "overdue" ? "text-red-600" : item.status === "due" ? "text-amber-600" : "text-muted"}`}>
          {item.meta}
        </span>
      ) : null}
    </span>
  );
}

export default function RhythmRibbon({ segments, className = "" }: { segments: RhythmSegment[]; className?: string }) {
  if (!segments || segments.length === 0) return null;
  return (
    <section aria-label="Operating rhythm" className={`mb-5 ${className}`}>
      {/* A single horizontally-scrollable row on phones; a 4-up grid from sm up. */}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {segments.map((seg) => (
          <div
            key={seg.horizon}
            className="surface-light min-w-[78%] shrink-0 rounded-xl border border-line bg-card-grad p-3.5 shadow-[0_1px_2px_rgba(8,37,24,0.04)] sm:min-w-0"
          >
            <div className="mb-2 flex items-center gap-2 border-b border-line pb-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <HorizonIcon horizon={seg.horizon} />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-light leading-tight tracking-tight text-ink">{seg.label}</div>
                <div className="truncate text-[11px] text-muted">{seg.dateLabel}</div>
              </div>
            </div>
            <ul className="space-y-1.5">
              {seg.items.map((item) =>
                item.href ? (
                  <li key={item.key}>
                    <Link href={item.href} className="block rounded-lg px-1 py-1 hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                      <RowBody item={item} />
                    </Link>
                  </li>
                ) : (
                  <li key={item.key} className="px-1 py-1">
                    <RowBody item={item} />
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
