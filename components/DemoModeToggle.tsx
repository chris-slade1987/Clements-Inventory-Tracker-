"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

// Admin control to flip Demo Mode on/off from inside the app (Users & Access).
// Turning ON seeds realistic sample data and shows the demo banner everywhere;
// turning OFF clears only the demo-marked rows. Real data is never touched.
export default function DemoModeToggle({ initialOn }: { initialOn: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initialOn);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function set(next: boolean) {
    if (busy) return;
    if (next && !confirm("Turn ON demo mode? This seeds realistic sample data across the app for demoing. Real data is untouched.")) return;
    if (!next && !confirm("Turn OFF demo mode? This clears the demo sample data (real data is untouched).")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setOn(data.on);
        setMsg(data.on ? "Demo mode on — sample data seeded." : "Demo mode off — demo data cleared.");
        router.refresh();
      } else {
        setMsg(data?.error ?? "Could not change demo mode.");
      }
    } catch {
      setMsg("Could not change demo mode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            Demo mode
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? "bg-emerald-100 text-emerald-800" : "bg-black/[0.06] text-muted"}`}>
              {on ? "On" : "Off"}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {on
              ? "Sample data is live and a banner shows across the app. Turn off to clear it."
              : "Flip on to seed realistic sample data for a live demo. Real data is never touched."}
          </div>
        </div>
        <button
          type="button"
          onClick={() => set(!on)}
          disabled={busy}
          className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-[filter] disabled:opacity-50 ${
            on ? "border border-line bg-white text-ink hover:bg-black/[0.03]" : "bg-emerald-grad text-white hover:brightness-110"
          }`}
        >
          {busy ? "Working…" : on ? "Turn off demo mode" : "Turn on demo mode"}
        </button>
      </div>
      {msg ? <div className="mt-3 rounded-lg border border-line bg-black/[0.03] px-3 py-2 text-xs text-ink">{msg}</div> : null}
    </Card>
  );
}
