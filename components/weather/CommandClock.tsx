"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updatedAgo } from "@/lib/weather/ui";

// The command-deck clock + sync console. Shows a live Eastern (ops) time with a
// Zulu/UTC readout, the data sync age, and a manual refresh. Auto-refreshes the
// server page every 5 minutes (skipped while the tab is hidden, so a backgrounded
// deck doesn't churn). Time is client-only to avoid a hydration mismatch.
export default function CommandClock({ scope, updatedAt, stale }: { scope: string; updatedAt: string | null; stale: boolean }) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0); // first value via a callback (not a sync effect setState)
    const t = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [router]);

  async function refresh() {
    setBusy(true);
    try {
      await fetch(`/api/weather?branch=${encodeURIComponent(scope)}&brief=0&force=1`, { cache: "no-store" });
    } catch {
      /* non-fatal — page keeps last-good data */
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  const etTime = now
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now)
    : "--:--:--";
  const etDate = now ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(now) : "";
  const zulu = now
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).replace(":", "") + "Z"
    : "----Z";

  return (
    <div className="flex items-center gap-4">
      <div className="text-right">
        <div className="text-2xl font-light tabular-nums leading-none tracking-tight text-ink">{etTime}</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted">{etDate} · {zulu} · ET</div>
      </div>
      <div className="h-9 w-px bg-white/10" />
      <div className="text-right">
        <div className="flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${stale ? "bg-amber-400" : "bg-emerald-400 wx-lamp-live"}`} style={{ ["--wx-ring" as string]: stale ? "rgba(251,191,36,.5)" : "rgba(52,211,153,.5)" }} />
          {stale ? "Stale feed" : "Live"}
        </div>
        <div className="mt-1 text-[11px] text-muted">Sync {updatedAgo(updatedAt)}</div>
      </div>
      <button
        onClick={refresh}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-ink hover:bg-white/10 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M21 12a9 9 0 11-2.64-6.36M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy ? "Syncing…" : "Sync"}
      </button>
    </div>
  );
}
