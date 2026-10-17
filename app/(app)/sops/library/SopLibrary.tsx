"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

export type SopTemplateDTO = {
  id: string;
  key: string;
  title: string;
  category: string | null;
  version: number;
  active: boolean;
  dueRule: string;
  stepCount: number;
  openAssignments: number;
};

export type AssignmentDTO = {
  id: string;
  templateTitle: string;
  branchLabel: string;
  dueDate: string | null;
  overdue: boolean;
  assignedByName: string | null;
};

const DATE = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function SopLibrary({
  templates,
  assignments,
  branches,
}: {
  templates: SopTemplateDTO[];
  assignments: AssignmentDTO[];
  branches: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [assignFor, setAssignFor] = useState<SopTemplateDTO | null>(null);
  const [branch, setBranch] = useState(branches[0]?.key ?? "");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");

  async function post(payload: Record<string, unknown>, okMsg: string, key: string) {
    setBusy(key); setMsg(null); setErr(false);
    try {
      const res = await fetch("/api/sops/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      setBusy(null);
      if (!res.ok) { setErr(true); setMsg(d.error ?? "Could not save."); return false; }
      setMsg(okMsg);
      router.refresh();
      return true;
    } catch (e) { setBusy(null); setErr(true); setMsg((e as Error).message); return false; }
  }

  const toggleActive = (t: SopTemplateDTO) =>
    post({ action: "setActive", templateId: t.id, active: !t.active }, t.active ? "Deactivated." : "Activated.", `active:${t.id}`);

  async function assign() {
    if (!assignFor) return;
    const ok = await post({ action: "assign", templateId: assignFor.id, branch, dueDate: dueDate || null, note }, "Assigned.", `assign:${assignFor.id}`);
    if (ok) { setAssignFor(null); setDueDate(""); setNote(""); }
  }

  return (
    <div className="space-y-6">
      {msg ? <p className={`text-sm ${err ? "text-red-600" : "text-brand-700"}`}>{msg}</p> : null}

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-line text-sm font-medium text-ink">SOP templates</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-line">
                <th className="px-4 py-2.5 font-semibold">SOP</th>
                <th className="px-4 py-2.5 font-semibold">Version</th>
                <th className="px-4 py-2.5 font-semibold">Steps</th>
                <th className="px-4 py-2.5 font-semibold">Open</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{t.title}</div>
                    <div className="text-xs text-muted">{t.category ? `${t.category} · ` : ""}{t.dueRule === "adhoc" ? "Ad-hoc" : "Recurring"}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">v{t.version}</td>
                  <td className="px-4 py-3 tabular-nums">{t.stepCount}</td>
                  <td className="px-4 py-3 tabular-nums">{t.openAssignments}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${t.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {t.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {t.active ? (
                        <button onClick={() => setAssignFor(assignFor?.id === t.id ? null : t)} className={btn.secondary} disabled={busy !== null}>
                          Assign
                        </button>
                      ) : null}
                      <button onClick={() => toggleActive(t)} className={btn.secondary} disabled={busy === `active:${t.id}`}>
                        {busy === `active:${t.id}` ? "Working…" : t.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Assign panel */}
      {assignFor ? (
        <Card className="p-5 ring-1 ring-brand-200">
          <div className="text-sm font-medium text-ink">Assign &ldquo;{assignFor.title}&rdquo;</div>
          <p className="mt-1 text-xs text-muted">Pick a branch and an optional due date. The branch manager runs it from their SOP runner.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-ink">Branch</span>
              <select value={branch} onChange={(e) => setBranch(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface">
                {branches.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-ink">Due date (optional)</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface" />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-ink">Note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Before month-end" className="w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface" />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={assign} disabled={busy !== null} className={btn.primary}>{busy === `assign:${assignFor.id}` ? "Assigning…" : "Assign SOP"}</button>
            <button onClick={() => setAssignFor(null)} className={btn.secondary}>Cancel</button>
          </div>
        </Card>
      ) : null}

      {/* Open assignments */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-line text-sm font-medium text-ink">Open assignments</div>
        {assignments.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">No open assignments.</p>
        ) : (
          <ul className="divide-y divide-line">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{a.templateTitle}</div>
                  <div className="text-xs text-muted">{a.branchLabel}{a.assignedByName ? ` · by ${a.assignedByName}` : ""}</div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${a.overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                  {a.overdue ? "Overdue" : a.dueDate ? `Due ${DATE(a.dueDate)}` : "Open"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-muted">A full in-app SOP authoring UI (create/edit steps) is planned; templates are seeded via the deploy path for now.</p>
    </div>
  );
}
