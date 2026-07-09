"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { EMPLOYEE_ROLES, EMPLOYEE_DIVISIONS } from "@/lib/constants";

type Option = { id: string; name: string };
type Tech = {
  id: string;
  name: string;
  homeWarehouseId: string;
  homeWarehouseName: string;
  employeeIdCard: string | null;
  role: string;
  division: string | null;
  active: boolean;
};
type FormState = {
  id: string;
  name: string;
  homeWarehouseId: string;
  employeeIdCard: string;
  role: string;
  division: string;
};

export default function ManageTechnicians({
  technicians,
  warehouses,
}: {
  technicians: Tech[];
  warehouses: Option[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [replace, setReplace] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const visible = technicians.filter((t) => showInactive || t.active);

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/manage/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: form.id ? "update" : "create", ...form }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setForm(null);
    router.refresh();
  }

  async function setActive(id: string, active: boolean) {
    await fetch("/api/manage/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setActive", id, active }),
    });
    router.refresh();
  }

  async function onImport(file: File) {
    setBusy(true);
    setNote(null);
    setError(null);
    const fd = new FormData();
    fd.append("type", "technicians");
    fd.append("file", file);
    if (replace) fd.append("replace", "true");
    const res = await fetch("/api/manage/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return setError(data.error ?? "Import failed.");
    setNote(
      `Imported: ${data.created} added, ${data.updated} updated` +
        (data.skipped?.length ? `, ${data.skipped.length} skipped (${data.skipped.slice(0, 2).join("; ")}${data.skipped.length > 2 ? "…" : ""}).` : ".")
    );
    router.refresh();
  }

  const newForm = (): FormState => ({
    id: "",
    name: "",
    homeWarehouseId: warehouses[0]?.id ?? "",
    employeeIdCard: "",
    role: "Technician",
    division: "",
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => setForm(newForm())} className={btn.primary}>+ Add employee</button>
        <button onClick={() => fileRef.current?.click()} disabled={busy} className={btn.secondary}>Import file</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Replace roster (deactivate others)
        </label>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <p className="text-xs text-muted mb-3">
        Import an Excel (.xlsx) or CSV with columns like <code>Employee Name, Role, Division, Branch/Warehouse</code> (FDACS card optional).
        Branch is matched by name. Tick <em>Replace roster</em> on the first load to deactivate anyone not in the file.
      </p>

      {note ? <p className="mb-3 text-sm text-brand-700">{note}</p> : null}
      {error && !form ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-3 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Division</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">FDACS #</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id} className={`border-b border-line last:border-0 ${!t.active ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2">{t.role}</td>
                  <td className="px-3 py-2">{t.division ?? "—"}</td>
                  <td className="px-3 py-2">{t.homeWarehouseName}</td>
                  <td className="px-3 py-2 text-xs">{t.employeeIdCard ?? "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setForm({ id: t.id, name: t.name, homeWarehouseId: t.homeWarehouseId, employeeIdCard: t.employeeIdCard ?? "", role: t.role, division: t.division ?? "" })} className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
                    <span className="text-line px-1">·</span>
                    {t.active ? (
                      <button onClick={() => setActive(t.id, false)} className="text-xs font-medium text-red-600 hover:underline">Deactivate</button>
                    ) : (
                      <button onClick={() => setActive(t.id, true)} className="text-xs font-medium text-brand-700 hover:underline">Reactivate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {form ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
            <h3 className="text-lg font-semibold">{form.id ? "Edit employee" : "Add employee"}</h3>
            <label className="block text-sm font-medium">Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Role
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  {EMPLOYEE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Division
                <select value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="">—</option>
                  {EMPLOYEE_DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium">Branch
              <select value={form.homeWarehouseId} onChange={(e) => setForm({ ...form, homeWarehouseId: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">FDACS card # (optional)
              <input value={form.employeeIdCard} onChange={(e) => setForm({ ...form, employeeIdCard: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setForm(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
