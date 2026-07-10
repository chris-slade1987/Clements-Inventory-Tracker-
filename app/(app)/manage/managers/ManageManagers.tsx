"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Option = { id: string; name: string };
type Manager = {
  id: string;
  name: string;
  email: string;
  role: string;
  warehouseName: string | null;
  active: boolean;
};

export default function ManageManagers({
  managers,
  warehouses,
  currentUserId,
}: {
  managers: Manager[];
  warehouses: Option[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const [addForm, setAddForm] = useState<{ name: string; email: string; password: string; role: string; warehouseId: string } | null>(null);
  const [pwFor, setPwFor] = useState<Manager | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const visible = managers.filter((m) => showInactive || m.active);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/manage/managers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async function createManager() {
    if (!addForm) return;
    setBusy(true); setError(null);
    const { ok, data } = await post({ action: "create", ...addForm });
    setBusy(false);
    if (!ok) return setError(data.error ?? "Create failed.");
    setAddForm(null);
    setNote(`Added ${addForm.name}.`);
    router.refresh();
  }

  async function setActive(id: string, active: boolean) {
    const { ok, data } = await post({ action: "setActive", id, active });
    if (!ok) { setNote(null); setError(data.error ?? "Failed."); return; }
    router.refresh();
  }

  async function resetPw() {
    if (!pwFor) return;
    setBusy(true); setError(null);
    const { ok, data } = await post({ action: "resetPassword", id: pwFor.id, password });
    setBusy(false);
    if (!ok) return setError(data.error ?? "Failed.");
    setPwFor(null); setPassword("");
    setNote(`Password reset for ${pwFor.name}. They'll need to sign in again.`);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => setAddForm({ name: "", email: "", password: "", role: "manager", warehouseId: "" })} className={btn.primary}>
          + Add manager
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <p className="text-xs text-muted mb-3">
        Managers sign in to the app. Branch controls their default warehouse; choose &ldquo;All branches&rdquo; for someone who works across locations. Admins can manage catalog and people.
      </p>

      {note ? <p className="mb-3 text-sm text-brand-200">{note}</p> : null}
      {error && !addForm && !pwFor ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id} className={`border-b border-line last:border-0 ${!m.active ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 font-medium">
                    {m.name}{m.id === currentUserId ? <span className="ml-1 text-xs text-muted">(you)</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{m.email}</td>
                  <td className="px-3 py-2 capitalize">{m.role}</td>
                  <td className="px-3 py-2">{m.warehouseName ?? "All branches"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => { setPwFor(m); setPassword(""); setError(null); }} className="text-xs font-medium text-brand-700 hover:underline">Reset password</button>
                    {m.id !== currentUserId ? (
                      <>
                        <span className="text-line px-1">·</span>
                        {m.active ? (
                          <button onClick={() => setActive(m.id, false)} className="text-xs font-medium text-red-600 hover:underline">Deactivate</button>
                        ) : (
                          <button onClick={() => setActive(m.id, true)} className="text-xs font-medium text-brand-700 hover:underline">Reactivate</button>
                        )}
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add manager modal */}
      {addForm ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="surface-light w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
            <h3 className="text-lg font-semibold">Add manager</h3>
            <label className="block text-sm font-medium">Name
              <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">Email
              <input type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">Temporary password
              <input value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} placeholder="min 8 characters" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Role
                <select value={addForm.role} onChange={(e) => setAddForm({ ...addForm, role: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label className="block text-sm font-medium">Branch
                <select value={addForm.warehouseId} onChange={(e) => setAddForm({ ...addForm, warehouseId: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                  <option value="">All branches</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setAddForm(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={createManager} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Add manager"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reset password modal */}
      {pwFor ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="surface-light w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
            <h3 className="text-lg font-semibold">Reset password</h3>
            <p className="text-sm text-muted">New password for <span className="font-medium text-ink">{pwFor.name}</span>. Any current sessions will be signed out.</p>
            <label className="block text-sm font-medium">New password
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setPwFor(null); setError(null); }} className={btn.secondary}>Cancel</button>
              <button onClick={resetPw} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Reset password"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
