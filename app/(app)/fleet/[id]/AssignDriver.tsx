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
  vehicleBranch = null,
  canMoveBranch = false,
  drivers,
}: {
  vehicleId: string;
  currentEmployeeId: string | null;
  currentName: string | null;
  vehicleBranch?: string | null;
  canMoveBranch?: boolean;
  drivers: Driver[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState(currentEmployeeId ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // When set, offer to move the vehicle to this branch (the new driver's branch).
  const [moveTo, setMoveTo] = useState<string | null>(null);

  const dirty = (sel || null) !== (currentEmployeeId || null);
  // If the assigned driver is no longer in the active roster (terminated), the
  // select can't represent them — flag it so the manager knows to reassign.
  const staleName = currentEmployeeId && !drivers.some((d) => d.id === currentEmployeeId) ? currentName : null;

  async function save(nextId: string | null) {
    setBusy(true);
    setMsg(null);
    setMoveTo(null);
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
        setMsg(nextId ? `Assigned to ${d.driver}.` : "Driver removed.");
        // Offer a branch move when the new driver sits in a different office.
        const driver = nextId ? drivers.find((x) => x.id === nextId) : null;
        if (canMoveBranch && driver?.branch && driver.branch !== vehicleBranch) setMoveTo(driver.branch);
        router.refresh();
      }
    } catch {
      setMsg("Could not update the driver.");
    } finally {
      setBusy(false);
    }
  }

  async function moveBranch(branch: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/fleet/vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "setBranch", id: vehicleId, branch }),
      });
      if (res.ok) { setMsg(`Moved to ${branchLabel(branch)}.`); setMoveTo(null); router.refresh(); }
      else setMsg("Could not move the vehicle.");
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
      {moveTo ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          <span>New driver is in <span className="font-medium">{branchLabel(moveTo)}</span>. Move this vehicle there?</span>
          <button onClick={() => moveBranch(moveTo)} disabled={busy} className="rounded-md bg-amber-600 px-2 py-0.5 font-medium text-white disabled:opacity-50">Move</button>
          <button onClick={() => setMoveTo(null)} disabled={busy} className="font-medium text-amber-700 hover:underline">Keep here</button>
        </div>
      ) : null}
    </div>
  );
}
