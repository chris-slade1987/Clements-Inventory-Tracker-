"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Month picker + Month/YTD basis toggle. Preserves the other query params
// (scope/branch drill-down) when switching.
export default function Controls({
  periods,
  period,
  basis,
  basePath = "/management",
}: {
  periods: { key: string; label: string }[];
  period: string;
  basis: string;
  basePath?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function go(next: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) params.set(k, v);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs font-medium text-mint">
        Month
        <select
          value={period}
          onChange={(e) => go({ p: e.target.value })}
          className="rounded-lg border border-line px-3 py-1.5 text-sm bg-surface text-ink"
        >
          {periods.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </label>

      <div className="flex gap-1 rounded-xl bg-black/20 p-1">
        {[
          { key: "month", label: "This month" },
          { key: "ytd", label: "Year to date" },
        ].map((b) => (
          <button
            key={b.key}
            onClick={() => go({ basis: b.key })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              basis === b.key ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
