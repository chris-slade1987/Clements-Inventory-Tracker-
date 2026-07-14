"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { BRANCHES, branchLabel } from "@/lib/management";

type Emp = { id: string; name: string; branch: string | null };

export default function AssignClient({ courseId, employees, assignedIds }: { courseId: string; employees: Emp[]; assignedIds: string[] }) {
  const router = useRouter();
  const already = new Set(assignedIds);
  const [branch, setBranch] = useState<string>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const visible = useMemo(() => employees.filter((e) => branch === "all" || e.branch === branch), [employees, branch]);

  function toggle(id: string) { setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function selectAll() { setPicked(new Set(visible.filter((e) => !already.has(e.id)).map((e) => e.id))); }

  async function assign() {
    if (picked.size === 0) return setMsg("Pick at least one employee.");
    setBusy(true); setMsg(null);
    const res = await fetch("/api/management/course/manage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", courseId, employeeIds: [...picked], dueDate: dueDate || null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(data.error ?? "Assign failed.");
    setMsg(`Assigned ${data.assigned}${data.emailed ? ` · ${data.emailed} emailed` : ""}.`);
    setPicked(new Set());
    router.refresh();
  }

  return (
    <Card className="p-4">
      <div className="text-sm font-medium text-ink mb-2">Assign to employees</div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-sm bg-surface">
          <option value="all">All branches</option>
          {BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
        <label className="text-xs text-muted flex items-center gap-1">Due<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-sm text-ink" /></label>
        <button onClick={selectAll} className="text-xs font-medium text-brand-700 hover:underline">Select all</button>
      </div>
      <div className="max-h-60 overflow-y-auto rounded-lg border border-line divide-y divide-line">
        {visible.map((e) => {
          const done = already.has(e.id);
          return (
            <label key={e.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${done ? "opacity-50" : "cursor-pointer hover:bg-black/[0.02]"}`}>
              <input type="checkbox" disabled={done} checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
              <span className="flex-1">{e.name}</span>
              <span className="text-xs text-muted">{done ? "assigned" : e.branch ? branchLabel(e.branch) : "—"}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={assign} disabled={busy} className={btn.primary}>{busy ? "Assigning…" : `Assign ${picked.size || ""}`.trim()}</button>
        {msg ? <span className="text-xs text-muted">{msg}</span> : null}
      </div>
    </Card>
  );
}
