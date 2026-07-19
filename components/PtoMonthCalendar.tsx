import Link from "next/link";
import { Card } from "@/components/ui";
import { branchLabel } from "@/lib/management";

// Presentational month grid of approved PTO. Server component (no hooks) — the
// page computes the events and hands them in. Each event paints every calendar
// day it spans; prev/next navigate by `?month=YYYY-MM`.

export type PtoEvent = { id: string; employeeName: string; branch: string | null; type: string; startISO: string; endISO: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Stable per-branch dot colors so the same person reads consistently.
const TYPE_DOT: Record<string, string> = {
  vacation: "bg-emerald-500",
  sick: "bg-red-500",
  personal: "bg-violet-500",
  unpaid: "bg-slate-400",
  other: "bg-amber-500",
};

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export default function PtoMonthCalendar({
  year,
  month, // 1-12
  events,
  basePath,
  preserve = {},
  showBranch = false,
}: {
  year: number;
  month: number;
  events: PtoEvent[];
  /** Pathname only (no query string). */
  basePath: string;
  /** Extra query params to carry across month navigation (e.g. { branch }). */
  preserve?: Record<string, string>;
  showBranch?: boolean;
}) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leading = first.getUTCDay(); // 0=Sun
  const cells: (number | null)[] = [
    ...Array(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // Map each day number -> events active that day.
  const byDay = new Map<number, PtoEvent[]>();
  for (let d = 1; d <= daysInMonth; d++) {
    const key = ymd(new Date(Date.UTC(year, month - 1, d)));
    const hits = events.filter((e) => e.startISO.slice(0, 10) <= key && key <= e.endISO.slice(0, 10));
    if (hits.length) byDay.set(d, hits);
  }

  const prevMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const build = (params: Record<string, string>) => {
    const sp = new URLSearchParams({ ...preserve, ...params });
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const q = (y: number, m: number) => build({ month: `${y}-${String(m).padStart(2, "0")}` });

  const today = new Date();
  const todayKey = ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div className="text-sm font-medium text-ink">{MONTHS[month - 1]} {year}</div>
        <div className="flex items-center gap-1">
          <Link href={q(prevMonth.y, prevMonth.m)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-black/[0.04]">← Prev</Link>
          <Link href={build({})} className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted hover:bg-black/[0.04]">Today</Link>
          <Link href={q(nextMonth.y, nextMonth.m)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-black/[0.04]">Next →</Link>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-line bg-black/[0.02] text-center text-[11px] font-medium uppercase tracking-wider text-muted">
        {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const isWeekend = i % 7 === 0 || i % 7 === 6;
          const dayKey = day ? ymd(new Date(Date.UTC(year, month - 1, day))) : "";
          const isToday = dayKey === todayKey;
          const hits = day ? byDay.get(day) ?? [] : [];
          return (
            <div key={i} className={`min-h-[84px] border-b border-r border-line p-1.5 ${isWeekend ? "bg-black/[0.015]" : ""} ${i % 7 === 6 ? "border-r-0" : ""}`}>
              {day ? (
                <>
                  <div className={`text-[11px] tabular-nums ${isToday ? "inline-grid h-5 w-5 place-items-center rounded-full bg-emerald-grad font-semibold text-[#05271c]" : "text-muted"}`}>{day}</div>
                  <div className="mt-1 space-y-0.5">
                    {hits.slice(0, 4).map((e) => (
                      <div key={e.id + day} className="flex items-center gap-1 truncate rounded bg-black/[0.03] px-1 py-0.5 text-[10px] text-ink" title={`${e.employeeName} · ${e.type}${e.branch ? ` · ${branchLabel(e.branch)}` : ""}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_DOT[e.type] ?? "bg-brand-400"}`} />
                        <span className="truncate">{e.employeeName.split(" ")[0]}{showBranch && e.branch ? ` · ${branchLabel(e.branch).slice(0, 4)}` : ""}</span>
                      </div>
                    ))}
                    {hits.length > 4 ? <div className="px-1 text-[10px] text-muted">+{hits.length - 4} more</div> : null}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[11px] text-muted">
        {Object.entries(TYPE_DOT).map(([type, dot]) => (
          <span key={type} className="flex items-center gap-1.5 capitalize"><span className={`h-2 w-2 rounded-full ${dot}`} />{type}</span>
        ))}
      </div>
    </Card>
  );
}
