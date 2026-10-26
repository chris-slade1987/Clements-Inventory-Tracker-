"use client";

import { useEffect, useRef, useState } from "react";
import WeatherGlyph, { glyphFor } from "./WeatherGlyph";
import { dayParts } from "@/lib/weather/ui";
import type { HourPoint } from "@/lib/weather/types";

// Weather Ops — 5-day outlook with click-to-expand days. Each day tile shows hi/lo + rain;
// clicking it turns the tile white (surface-light) and opens an extended hourly strip for
// that day plus a generated plain-English summary. Built from the hourly feed so the day
// detail is real hour-by-hour data. See docs/WEATHER-OPS.md.

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const [y, m, d] = date.split("-").map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${m}/${d}`;
}
function hourLabel(iso: string): string {
  const h = Number(iso.slice(11, 13));
  const ap = h < 12 ? "a" : "p";
  return `${h % 12 || 12}${ap}`;
}

type DayGroup = { date: string; hi: number | null; lo: number | null; pop: number; peakWind: number; short: string; hrs: HourPoint[] };

function buildDays(hourly: HourPoint[]): DayGroup[] {
  const byDate = new Map<string, HourPoint[]>();
  for (const h of hourly) {
    const d = h.time.slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(h);
  }
  return [...byDate.keys()].sort().slice(0, 5).map((date) => {
    const hrs = byDate.get(date)!;
    const temps = hrs.map((h) => h.tempF).filter((n): n is number => n != null);
    const mid = hrs.find((h) => Number(h.time.slice(11, 13)) === 13) ?? hrs[Math.floor(hrs.length / 2)];
    return {
      date,
      hi: temps.length ? Math.max(...temps) : null,
      lo: temps.length ? Math.min(...temps) : null,
      pop: Math.max(0, ...hrs.map((h) => h.pop)),
      peakWind: Math.max(0, ...hrs.map((h) => h.windMph ?? 0)),
      short: mid?.short ?? hrs[0]?.short ?? "",
      hrs,
    };
  });
}

// A deterministic, instant plain-English read of the day (no AI round-trip).
function summarize(d: DayGroup): string {
  const work = d.hrs.filter((h) => { const hr = Number(h.time.slice(11, 13)); return hr >= 6 && hr <= 20; });
  const parts: string[] = [];
  parts.push(`High ${d.hi ?? "—"}°${d.lo != null ? `, low ${d.lo}°` : ""}.`);
  const rainy = work.filter((h) => h.pop >= 50);
  if (rainy.length) {
    const peak = work.reduce((a, b) => (b.pop > a.pop ? b : a), work[0]);
    parts.push(`Rain most likely ${hourLabel(rainy[0].time)}–${hourLabel(rainy[rainy.length - 1].time)} (peak ${peak.pop}% near ${hourLabel(peak.time)}).`);
  } else if (d.pop >= 25) {
    parts.push(`Spotty showers possible (${d.pop}%).`);
  } else {
    parts.push("Mostly dry — a solid work day.");
  }
  // Best dry work window: the longest run of daytime hours under 30% POP.
  let bestStart: HourPoint | null = null, bestEnd: HourPoint | null = null, runStart: HourPoint | null = null, best = 0, cur = 0;
  for (const h of work) {
    if (h.pop < 30) { if (!runStart) runStart = h; cur++; if (cur > best) { best = cur; bestStart = runStart; bestEnd = h; } }
    else { runStart = null; cur = 0; }
  }
  if (best >= 3 && bestStart && bestEnd && rainy.length) parts.push(`Best window ${hourLabel(bestStart.time)}–${hourLabel(bestEnd.time)}.`);
  if (d.peakWind >= 15) parts.push(`Breezy — up to ${d.peakWind} mph.`);
  return parts.join(" ");
}

export default function FiveDayOutlook({ hourly, today }: { hourly: HourPoint[]; today: string }) {
  const days = buildDays(hourly);
  const [sel, setSel] = useState<string | null>(null);
  const selDay = days.find((d) => d.date === sel) ?? null;
  const detailRef = useRef<HTMLDivElement | null>(null);

  // Click feedback: when a day opens, slide its detail into view so the user
  // sees a reaction instead of hunting for what expanded below the fold.
  useEffect(() => {
    if (sel && detailRef.current) detailRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [sel]);

  if (days.length === 0) return <p className="text-sm text-muted">Hourly outlook unavailable right now.</p>;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {days.map((d) => {
          const on = d.date === sel;
          return (
            <button
              key={d.date}
              onClick={() => setSel(on ? null : d.date)}
              aria-expanded={on}
              className={`flex flex-col items-center rounded-lg border px-2 py-3 text-center transition ${
                on
                  ? "surface-light border-line bg-white shadow-[0_12px_34px_-14px_rgba(0,0,0,.55)]"
                  : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
              }`}
            >
              <div className="truncate text-xs font-medium text-ink">{dayLabel(d.date, today)}</div>
              <WeatherGlyph kind={glyphFor(d.short)} className={`my-2 h-9 w-9 ${on ? "text-brand-700" : "text-brand-300"}`} />
              <div className="text-sm tabular-nums text-ink"><span className="font-medium">{d.hi != null ? `${d.hi}°` : "—"}</span>{d.lo != null && <span className="text-muted"> / {d.lo}°</span>}</div>
              <div className={`mt-0.5 text-[11px] ${on ? "text-brand-700" : "text-brand-300"}`}>{d.pop}% rain</div>
              <div className="mt-1 text-[9px] uppercase tracking-[0.14em] text-muted">{on ? "Hide ▲" : "Details ▾"}</div>
            </button>
          );
        })}
      </div>

      {selDay && (
        <div ref={detailRef} className="mt-3 scroll-mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-ink">{dayLabel(selDay.date, today)} · hourly detail</div>
            <div className="text-[11px] tabular-nums text-muted">{selDay.hi != null ? `${selDay.hi}°` : "—"}{selDay.lo != null ? ` / ${selDay.lo}°` : ""} · {selDay.pop}% rain · {selDay.peakWind} mph</div>
          </div>
          <p className="mt-1.5 text-sm text-ink/90">{summarize(selDay)}</p>

          {/* Morning / Midday / Afternoon rundown for the selected day. */}
          {(() => {
            const parts = dayParts(selDay.hrs);
            if (!parts.length) return null;
            return (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {parts.map((p) => (
                  <div key={p.label} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-brand-300">{p.label}</div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-sm font-light tabular-nums text-ink">{p.temp}</span>
                      <span className={`text-[11px] ${p.pop >= 60 ? "text-sky-300" : p.pop >= 30 ? "text-brand-300" : "text-muted"}`}>{p.rain}</span>
                    </div>
                    <div className="truncate text-xs text-muted" title={p.sky}>{p.sky}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="mt-3 overflow-x-auto">
            <div className="flex gap-1.5">
              {selDay.hrs
                .filter((h) => { const hr = Number(h.time.slice(11, 13)); return hr >= 6 && hr <= 20; })
                .map((h) => {
                  const wet = h.pop >= 50;
                  return (
                    <div key={h.time} className={`flex-1 min-w-[46px] rounded-lg border px-1 py-2 text-center ${wet ? "border-sky-400/40 bg-sky-500/15" : "border-white/10 bg-white/[0.02]"}`}>
                      <div className="text-[10px] text-muted">{hourLabel(h.time)}</div>
                      <WeatherGlyph kind={glyphFor(h.short)} className="mx-auto my-0.5 h-4 w-4 text-brand-300" />
                      <div className="text-sm font-light tabular-nums text-ink">{h.tempF != null ? `${h.tempF}°` : "—"}</div>
                      <div className="text-[10px] text-brand-300">{h.pop}%</div>
                      <div className="text-[10px] text-muted">{h.windMph != null ? `${h.windMph}mph` : ""}</div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
