"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

export type ReminderRow = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string; // ISO
  severity: string;
  status: string;
  employeeName?: string | null;
  vehicleLabel?: string | null;
};
type Opt = { id: string; label: string };

const SEVERITY = [
  { key: "info", label: "Info" },
  { key: "warning", label: "Important" },
  { key: "critical", label: "Critical" },
];
const NOTIFY = [
  { key: "hr", label: "HR" },
  { key: "creator", label: "Me" },
  { key: "both", label: "HR & me" },
];

const SEV_DOT: Record<string, string> = { critical: "bg-red-500", warning: "bg-amber-500", info: "bg-brand-400" };

/**
 * Reminders widget. `mode="card"` renders the list + an Add button (profiles);
 * `mode="button"` renders just the Add button (dashboard). Preset an entity to
 * tag the reminder to this employee/vehicle; otherwise offer optional pickers.
 */
export default function RemindersCard({
  mode = "card",
  title = "Reminders",
  reminders = [],
  preset,
  employees = [],
  vehicles = [],
  canManage = true,
}: {
  mode?: "card" | "button";
  title?: string;
  reminders?: ReminderRow[];
  preset?: { employeeId?: string; vehicleId?: string; label?: string };
  employees?: Opt[];
  vehicles?: Opt[];
  canManage?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ title: "", dueDate: "", leadDays: "14", severity: "info", notify: "hr", notes: "", employeeId: preset?.employeeId ?? "", vehicleId: preset?.vehicleId ?? "" });

  async function save() {
    if (!f.title.trim()) return setError("Give the reminder a title.");
    if (!f.dueDate) return setError("Choose when it's due.");
    setBusy(true); setError(null);
    const res = await fetch("/api/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", ...f }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not save.");
    setOpen(false);
    setF({ title: "", dueDate: "", leadDays: "14", severity: "info", notify: "hr", notes: "", employeeId: preset?.employeeId ?? "", vehicleId: preset?.vehicleId ?? "" });
    router.refresh();
  }
  async function act(id: string, action: string) {
    await fetch("/api/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
    router.refresh();
  }

  const AddButton = <button onClick={() => { setOpen(true); setError(null); }} className={mode === "button" ? btn.secondary : "text-xs font-medium text-brand-700 hover:underline"}>+ Reminder</button>;

  const Modal = open ? (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">New reminder{preset?.label ? ` · ${preset.label}` : ""}</h3>
        <label className="block text-sm font-medium">What to remember
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Move Sam to Auto-Owners after probation" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
        {!preset && (employees.length > 0 || vehicles.length > 0) ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">Tag employee
              <select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value, vehicleId: e.target.value ? "" : f.vehicleId })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                <option value="">— none —</option>
                {employees.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">Tag vehicle
              <select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value, employeeId: e.target.value ? "" : f.employeeId })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                <option value="">— none —</option>
                {vehicles.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">Due date
            <input type="date" min={today} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
          </label>
          <label className="block text-sm font-medium">Remind me this many days early
            <input value={f.leadDays} onChange={(e) => setF({ ...f, leadDays: e.target.value.replace(/[^0-9]/g, "") })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">Priority
            <select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              {SEVERITY.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Notify
            <select value={f.notify} onChange={(e) => setF({ ...f, notify: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              {NOTIFY.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium">Notes (optional)
          <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex gap-2 pt-1">
          <button onClick={() => { setOpen(false); setError(null); }} className={btn.secondary}>Cancel</button>
          <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Set reminder"}</button>
        </div>
      </Card>
    </div>
  ) : null;

  if (mode === "button") return <>{canManage ? AddButton : null}{Modal}</>;

  const active = reminders.filter((r) => r.status === "open");
  const closed = reminders.filter((r) => r.status !== "open");

  return (
    <Card className="p-0 overflow-hidden mb-5">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div className="text-sm font-medium text-ink">{title}</div>
        {canManage ? AddButton : null}
      </div>
      {reminders.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">No reminders. Set one to get an alert before something is due.</p>
      ) : (
        <ul className="divide-y divide-line">
          {[...active, ...closed].map((r) => {
            const due = new Date(r.dueDate);
            const overdue = r.status === "open" && due.getTime() < Date.now();
            return (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.status !== "open" ? "bg-slate-300" : SEV_DOT[r.severity] ?? "bg-brand-400"}`} />
                <span className="flex-1">
                  <span className={`block text-sm font-medium ${r.status === "done" ? "text-muted line-through" : "text-ink"}`}>{r.title}</span>
                  <span className="block text-xs text-muted">
                    {r.status === "done" ? "Done" : r.status === "dismissed" ? "Dismissed" : overdue ? "Overdue" : "Due"} {due.toLocaleDateString()}
                    {r.notes ? ` · ${r.notes}` : ""}
                    {r.employeeName ? ` · ${r.employeeName}` : r.vehicleLabel ? ` · ${r.vehicleLabel}` : ""}
                  </span>
                </span>
                {canManage && r.status === "open" ? (
                  <span className="flex shrink-0 gap-2">
                    <button onClick={() => act(r.id, "complete")} className="text-xs font-medium text-brand-700 hover:underline">Done</button>
                    <button onClick={() => act(r.id, "dismiss")} className="text-xs text-muted hover:text-ink">Dismiss</button>
                  </span>
                ) : canManage ? (
                  <button onClick={() => act(r.id, "delete")} className="shrink-0 text-xs text-muted hover:text-red-600">Delete</button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {Modal}
    </Card>
  );
}
