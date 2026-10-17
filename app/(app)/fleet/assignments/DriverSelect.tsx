"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { branchLabel } from "@/lib/management";

// Compact inline driver picker for the assignments grid. Saves on change — pick
// a name to assign/swap, pick "— Unassigned —" to remove. Shows a tiny status tick.
// Behaves exactly like the per-vehicle AssignDriver picker: THE VEHICLE FOLLOWS
// ITS DRIVER — assigning a driver whose home branch differs moves the truck to
// that branch in the same write, and we surface the "moved to {branch}" result.
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
  const [moved, setMoved] = useState<string | null>(null);

  async function change(next: string) {
    setSel(next);
    setState("saving");
    setMoved(null);
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
        if (d.movedToBranch) setMoved(branchLabel(d.movedToBranch));
        router.refresh();
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1500);
      }
    } catch {
      setState("error");
    }
  }

  return (
    <div>
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
      {moved ? <p className="mt-0.5 text-[11px] text-brand-700">Moved to {moved}</p> : null}
    </div>
  );
}
