"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { btn } from "@/components/ui";
import { branchLabel } from "@/lib/management";

type Driver = { id: string; name: string; branch: string | null; meta: string };

// Assign / swap / remove the driver on a vehicle. Picks from the active-employee
// roster; Save assigns or swaps, Remove clears. The server keeps the assignedTo
// name string in sync with the structured link. When the new driver's home branch
// differs from the vehicle's, an admin is offered a one-click "move the vehicle to
// that branch" (manual — never automatic).
export default function AssignDriver({
  vehicleId,
  currentEmployeeId,
  currentName,
  drivers,
}: {
  vehicleId: string;
  currentEmployeeId: string | null;
  currentName: string | null;
  drivers: Driver[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState(currentEmployeeId ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = (sel || null) !== (currentEmployeeId || null);
  // If the assigned driver is no longer in the active roster (terminated), the
  // select can't represent them — flag it so the manager knows to reassign.
  const staleName = currentEmployeeId && !drivers.some((d) => d.id === currentEmployeeId) ? currentName : null;

  async function save(nextId: string | null) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/fleet/assign-driver", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vehicleId, employeeId: nextId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) {
        setMsg(d.error ?? "Could not update the driver.");
      } else {
        // The vehicle follows its driver: the server moves it to the new driver's
        // home branch automatically, so just reflect what happened.
        setMsg(
          nextId
            ? `Assigned to ${d.driver}${d.movedToBranch ? ` · moved to ${branchLabel(d.movedToBranch)}` : ""}.`
            : "Driver removed.",
        );
        router.refresh();
      }
    } catch {
      setMsg("Could not update the driver.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          disabled={busy}
          className="flex-1 min-w-[10rem] rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-ink"
        >
          <option value="">— Unassigned —</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}{d.meta ? ` · ${d.meta}` : ""}
            </option>
          ))}
        </select>
        <button className={btn.primary} disabled={busy || !dirty} onClick={() => save(sel || null)}>
          {busy ? "Saving…" : currentEmployeeId ? "Swap" : "Assign"}
        </button>
        {currentEmployeeId ? (
          <button
            className={btn.secondary}
            disabled={busy}
            onClick={() => { setSel(""); save(null); }}
          >
            Remove
          </button>
        ) : null}
      </div>
      {currentEmployeeId && !staleName ? (
        <Link href={`/management/people/${currentEmployeeId}`} className="mt-1 inline-block text-[11px] font-medium text-brand-700 hover:underline">
          View {currentName ?? "driver"}&rsquo;s profile →
        </Link>
      ) : null}
      {staleName ? (
        <p className="mt-1 text-[11px] text-amber-700">
          Currently “{staleName}” — no longer on the active roster. Pick a current driver to reassign.
        </p>
      ) : null}
      {msg ? <p className="mt-1 text-[11px] text-brand-700">{msg}</p> : null}
    </div>
  );
}
