"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Date-range control for the lead views: This month · Last month · Year-to-date ·
// custom. Writes `range` (+ `from`/`to` for custom) into the URL query so the
// server re-renders the filtered data. Preserves any other query params (branch).
const PRESETS: { key: string; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "ytd", label: "Year to date" },
];

export default function LeadRangeControl({ preset, from, to }: { preset: string; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [showCustom, setShowCustom] = useState(preset === "custom");
  const [cf, setCf] = useState(from);
  const [ct, setCt] = useState(to);

  function go(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null) sp.delete(k); else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function applyPreset(key: string) {
    setShowCustom(false);
    go({ range: key, from: null, to: null });
  }

  function applyCustom() {
    if (!cf || !ct || cf > ct) return;
    go({ range: "custom", from: cf, to: ct });
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${preset === p.key ? "bg-brand-600 text-white" : "border border-line bg-surface text-ink hover:bg-brand-50"}`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom((v) => !v)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${preset === "custom" ? "bg-brand-600 text-white" : "border border-line bg-surface text-ink hover:bg-brand-50"}`}
        >
          Custom range
        </button>
      </div>
      {showCustom ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3">
          <label className="text-xs text-muted">
            From
            <input type="date" value={cf} onChange={(e) => setCf(e.target.value)} className="mt-1 block rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink" />
          </label>
          <label className="text-xs text-muted">
            To
            <input type="date" value={ct} onChange={(e) => setCt(e.target.value)} className="mt-1 block rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink" />
          </label>
          <button onClick={applyCustom} disabled={!cf || !ct || cf > ct} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">Apply</button>
        </div>
      ) : null}
    </div>
  );
}
