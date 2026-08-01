"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Compact inline driver picker for the assignments grid. Saves on change — pick
// a name to assign/swap, pick "— Unassigned —" to remove. Shows a tiny status tick.
export default function DriverSelect({
  vehicleId,
  currentEmployeeId,
  drivers,
}: {
  vehicleId: string;
  currentEmployeeId: string | null;
  drivers: { id: string; name: string; meta: string }[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState(currentEmployeeId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function change(next: string) {
    setSel(next);
    setState("saving");
    try {
      const res = await fetch("/api/fleet/assign-driver", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vehicleId, employeeId: next || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) {
        setState("error");
      } else {
        setState("saved");
        router.refresh();
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
      }
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={sel}
        onChange={(e) => change(e.target.value)}
        disabled={state === "saving"}
        className={`w-full rounded-lg border bg-white px-2 py-1 text-sm text-ink ${sel ? "border-line" : "border-amber-300 bg-amber-50/40"}`}
      >
        <option value="">— Unassigned —</option>
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}{d.meta ? ` · ${d.meta}` : ""}
          </option>
        ))}
      </select>
      <span className="w-4 shrink-0 text-center text-xs" aria-live="polite">
        {state === "saving" ? <span className="text-muted">…</span> : state === "saved" ? <span className="text-emerald-600">✓</span> : state === "error" ? <span className="text-red-600" title="Save failed">!</span> : ""}
      </span>
    </div>
  );
}
