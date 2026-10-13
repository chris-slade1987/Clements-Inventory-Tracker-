"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

/**
 * Admin-only control for the one-module-per-month pacing limit
 * (Setting "training.modules_per_month"; 0 = off, default 1).
 */
export default function PacingControl({ current }: { current: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(next: number) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/training-center/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modulesPerMonth: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed.");
      setValue(String(data.modulesPerMonth));
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const n = Number(value);
  const enabled = Number(value) > 0;

  return (
    <Card className="mb-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">Module pacing (admin)</div>
          <div className="text-xs text-muted">
            Limit how many modules an employee may START per calendar month. {enabled ? `Currently ${n}/month.` : "Currently off."} Single
            courses are always exempt.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={btn.secondary} disabled={busy} onClick={() => save(enabled ? 0 : 1)}>
            {enabled ? "Turn off" : "Turn on"}
          </button>
          <input
            className="w-20 rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"
            type="number"
            min={0}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="button" className={btn.primary} disabled={busy || !Number.isInteger(n) || n < 0} onClick={() => save(n)}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {msg ? <p className="mt-2 text-xs text-emerald-700">{msg}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </Card>
  );
}
