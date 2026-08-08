"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type OrgEmployee = { id: string; name: string; role: string | null; title: string | null; branch: string | null; reportsToId: string | null };

const BRANCH: Record<string, string> = { vero: "Vero Beach", stuart: "Stuart", orlando: "Orlando", naples: "Naples" };

function descendants(rootId: string, emps: OrgEmployee[]): Set<string> {
  const kids = new Map<string, string[]>();
  for (const e of emps) if (e.reportsToId) (kids.get(e.reportsToId) ?? kids.set(e.reportsToId, []).get(e.reportsToId)!).push(e.id);
  const out = new Set<string>();
  const stack = [...(kids.get(rootId) ?? [])];
  while (stack.length) { const id = stack.pop()!; if (out.has(id)) continue; out.add(id); for (const c of kids.get(id) ?? []) stack.push(c); }
  return out;
}

export default function OrgChartClient({ employees }: { employees: OrgEmployee[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, OrgEmployee[]>();
    for (const e of employees) {
      const pid = e.reportsToId && byId.has(e.reportsToId) ? e.reportsToId : "__root__";
      (m.get(pid) ?? m.set(pid, []).get(pid)!).push(e);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [employees, byId]);

  const roots = childrenOf.get("__root__") ?? [];

  async function reassign(employeeId: string, reportsToId: string) {
    setBusy(employeeId); setError(null);
    const res = await fetch("/api/management/org", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, reportsToId: reportsToId || null }),
    });
    setBusy(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error ?? "Could not update the reporting line.");
    router.refresh();
  }

  function Node({ e, depth }: { e: OrgEmployee; depth: number }) {
    const kids = childrenOf.get(e.id) ?? [];
    const blocked = descendants(e.id, employees); // can't report to self or own team
    const options = employees.filter((o) => o.id !== e.id && !blocked.has(o.id)).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <li className="relative">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2">
          <div className="min-w-0">
            <div className="font-medium text-ink">{e.name}</div>
            <div className="text-[11px] text-muted">
              {[e.title || e.role, e.branch ? BRANCH[e.branch] ?? e.branch : null].filter(Boolean).join(" · ") || "—"}
              {kids.length ? <span className="ml-2 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">{kids.length} report{kids.length > 1 ? "s" : ""}</span> : null}
            </div>
          </div>
          <label className="ml-auto flex items-center gap-1 text-[11px] text-muted">
            Reports to
            <select
              value={e.reportsToId ?? ""}
              disabled={busy === e.id}
              onChange={(ev) => reassign(e.id, ev.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink disabled:opacity-50"
            >
              <option value="">— Top level —</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.title || o.role ? ` (${o.title || o.role})` : ""}</option>)}
            </select>
          </label>
        </div>
        {kids.length ? (
          <ul className="ml-4 mt-1.5 space-y-1.5 border-l border-line pl-3">
            {kids.map((k) => <Node key={k.id} e={k} depth={depth + 1} />)}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <div>
      {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
      {roots.length === 0 ? (
        <p className="text-sm text-muted">No employees to chart yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {roots.map((r) => <Node key={r.id} e={r} depth={0} />)}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted">Set each person&rsquo;s &ldquo;Reports to&rdquo; to build the tree. A lead&rsquo;s team is everyone beneath them. Top-level people (owners/execs) report to no one.</p>
    </div>
  );
}
