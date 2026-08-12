"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCESS_LEVELS, accessLevelLabel } from "@/lib/access-levels";

export type OrgEmployee = { id: string; name: string; role: string | null; title: string | null; branch: string | null; reportsToId: string | null; userId: string | null; accessLevel: string | null };

const BRANCH: Record<string, string> = { vero: "Vero Beach", stuart: "Stuart", orlando: "Orlando", naples: "Naples" };

// Card accent + chip by access level.
const LEVEL_STYLE: Record<string, { border: string; bg: string; chip: string }> = {
  super_admin: { border: "#059669", bg: "#ecfdf5", chip: "bg-emerald-100 text-emerald-800" },
  admin: { border: "#0284c7", bg: "#eff6ff", chip: "bg-sky-100 text-sky-800" },
  manager: { border: "#d97706", bg: "#fffbeb", chip: "bg-amber-100 text-amber-800" },
  csr: { border: "#7c3aed", bg: "#f5f3ff", chip: "bg-violet-100 text-violet-800" },
  technician: { border: "#94a3b8", bg: "#f8fafc", chip: "bg-slate-100 text-slate-700" },
  sales: { border: "#db2777", bg: "#fdf2f8", chip: "bg-pink-100 text-pink-800" },
};
const styleFor = (lvl: string | null) => LEVEL_STYLE[lvl ?? ""] ?? { border: "#cbd5e1", bg: "#ffffff", chip: "bg-black/5 text-muted" };

type View = "tree" | "list";

function descendants(rootId: string, emps: OrgEmployee[]): Set<string> {
  const kids = new Map<string, string[]>();
  for (const e of emps) if (e.reportsToId) (kids.get(e.reportsToId) ?? kids.set(e.reportsToId, []).get(e.reportsToId)!).push(e.id);
  const out = new Set<string>();
  const stack = [...(kids.get(rootId) ?? [])];
  while (stack.length) { const id = stack.pop()!; if (out.has(id)) continue; out.add(id); for (const c of kids.get(id) ?? []) stack.push(c); }
  return out;
}

export default function OrgChartClient({ employees, canEditLevels = false }: { employees: OrgEmployee[]; canEditLevels?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [view, setView] = useState<View>("tree");

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

  // Collapse big sub-teams by default so the chart stays readable.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const [pid, kids] of childrenOf) if (pid !== "__root__" && kids.length > 5) s.add(pid);
    return s;
  });
  const toggle = (id: string) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function reassign(employeeId: string, reportsToId: string) {
    setBusy(employeeId); setError(null);
    const res = await fetch("/api/management/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, reportsToId: reportsToId || null }) });
    setBusy(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error ?? "Could not update the reporting line.");
    router.refresh();
  }
  async function setLevel(userId: string, accessLevel: string) {
    setBusy(userId); setError(null);
    const res = await fetch("/api/management/access-level", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, accessLevel }) });
    setBusy(null);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setError(d.error ?? "Could not update the access level.");
    router.refresh();
  }

  const levelsPresent = ACCESS_LEVELS.filter((l) => employees.some((e) => e.accessLevel === l.key));

  // Shared edit controls (Reports-to + Access) — rendered in both views.
  function EditControls({ e }: { e: OrgEmployee }) {
    const blocked = descendants(e.id, employees);
    const options = employees.filter((o) => o.id !== e.id && !blocked.has(o.id)).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div className="oc-edit">
        <label>Reports to
          <select value={e.reportsToId ?? ""} disabled={busy === e.id} onChange={(ev) => reassign(e.id, ev.target.value)}>
            <option value="">— Top level —</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        {e.userId ? (
          <label>Access
            <select value={e.accessLevel ?? ""} disabled={busy === e.userId} onChange={(ev) => setLevel(e.userId as string, ev.target.value)}>
              <option value="" disabled>— set —</option>
              {ACCESS_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    );
  }

  // --- Tree view (top-down boxed cards with connector lines) ---
  function TreeNode({ e }: { e: OrgEmployee }) {
    const kids = childrenOf.get(e.id) ?? [];
    const isCollapsed = collapsed.has(e.id);
    const st = styleFor(e.accessLevel);
    return (
      <li>
        <div className="oc-card" style={{ borderColor: st.border, background: st.bg }}>
          <div className="oc-name">{e.name}</div>
          <div className="oc-sub">{[e.title || e.role, e.branch ? BRANCH[e.branch] ?? e.branch : null].filter(Boolean).join(" · ") || "—"}</div>
          <div className="oc-row">
            <span className={`oc-chip ${st.chip}`}>{e.userId ? accessLevelLabel(e.accessLevel) : "No login"}</span>
            {kids.length ? (
              <button onClick={() => toggle(e.id)} className="oc-toggle" title={isCollapsed ? "Expand team" : "Collapse team"}>
                {isCollapsed ? `+${kids.length}` : "−"}
              </button>
            ) : null}
          </div>
          {editMode && canEditLevels ? <EditControls e={e} /> : null}
        </div>
        {kids.length && !isCollapsed ? <ul>{kids.map((k) => <TreeNode key={k.id} e={k} />)}</ul> : null}
      </li>
    );
  }

  // --- List view (previous downward indented outline, level-colored) ---
  function ListNode({ e }: { e: OrgEmployee }) {
    const kids = childrenOf.get(e.id) ?? [];
    const isCollapsed = collapsed.has(e.id);
    const st = styleFor(e.accessLevel);
    return (
      <li>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2" style={{ borderLeftColor: st.border, borderLeftWidth: 4, background: st.bg }}>
          <div className="min-w-0">
            <div className="font-medium text-ink">{e.name}</div>
            <div className="text-[11px] text-muted">
              {[e.title || e.role, e.branch ? BRANCH[e.branch] ?? e.branch : null].filter(Boolean).join(" · ") || "—"}
              {kids.length ? <span className="ml-2 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-medium text-ink/70">{kids.length} report{kids.length > 1 ? "s" : ""}</span> : null}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.chip}`}>{e.userId ? accessLevelLabel(e.accessLevel) : "No login"}</span>
            {kids.length ? (
              <button onClick={() => toggle(e.id)} className="rounded-md border border-line bg-white px-1.5 text-[11px] font-bold leading-5 text-brand-700" title={isCollapsed ? "Expand team" : "Collapse team"}>
                {isCollapsed ? `+${kids.length}` : "−"}
              </button>
            ) : null}
          </div>
          {editMode && canEditLevels ? <div className="w-full">{<EditControls e={e} />}</div> : null}
        </div>
        {kids.length && !isCollapsed ? (
          <ul className="ml-4 mt-1.5 space-y-1.5 border-l border-line pl-3">
            {kids.map((k) => <ListNode key={k.id} e={k} />)}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <div>
      <style>{CSS}</style>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          {levelsPresent.map((l) => (
            <span key={l.key} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: styleFor(l.key).border }} />
              {l.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* View switch — the big tree or the previous downward outline. */}
          <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
            <button
              onClick={() => setView("tree")}
              className={`rounded-md px-2.5 py-1 font-medium ${view === "tree" ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink"}`}
            >
              Tree
            </button>
            <button
              onClick={() => setView("list")}
              className={`rounded-md px-2.5 py-1 font-medium ${view === "list" ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink"}`}
            >
              List
            </button>
          </div>
          {canEditLevels ? (
            <button onClick={() => setEditMode((v) => !v)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${editMode ? "border-brand-400 bg-brand-50 text-brand-700" : "border-line text-ink hover:border-brand-300"}`}>
              {editMode ? "Done editing" : "Edit structure & access"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}

      {roots.length === 0 ? (
        <p className="text-sm text-muted">No employees to chart yet.</p>
      ) : view === "tree" ? (
        <div className="oc-scroll overflow-x-auto pb-3">
          <div className="orgtree"><ul>{roots.map((r) => <TreeNode key={r.id} e={r} />)}</ul></div>
        </div>
      ) : (
        <ul className="space-y-1.5">{roots.map((r) => <ListNode key={r.id} e={r} />)}</ul>
      )}

      <p className="mt-2 text-[11px] text-muted">
        Cards are colored by access level (legend above). Switch between the <span className="font-medium">Tree</span> and the downward <span className="font-medium">List</span> outline. Click <span className="font-medium">+N</span> to expand a team, <span className="font-medium">−</span> to collapse.
        {canEditLevels ? " Use “Edit structure & access” to change a person’s manager or level — the chart redraws instantly and their profile updates." : ""}
      </p>
    </div>
  );
}

// Classic pure-CSS top-down org tree (connector lines via ::before/::after).
const CSS = `
.orgtree { display: inline-block; min-width: 100%; }
.orgtree ul { position: relative; padding: 22px 0 0 0; display: flex; justify-content: center; margin: 0; }
.orgtree li { display: flex; flex-direction: column; align-items: center; list-style: none; position: relative; padding: 22px 10px 0 10px; }
.orgtree li::before, .orgtree li::after { content: ''; position: absolute; top: 0; right: 50%; border-top: 2px solid #cfe3dc; width: 50%; height: 22px; }
.orgtree li::after { right: auto; left: 50%; border-left: 2px solid #cfe3dc; }
.orgtree li:only-child::after, .orgtree li:only-child::before { display: none; }
.orgtree li:only-child { padding-top: 22px; }
.orgtree li:first-child::before, .orgtree li:last-child::after { border: 0 none; }
.orgtree li:last-child::before { border-right: 2px solid #cfe3dc; border-radius: 0 6px 0 0; }
.orgtree li:first-child::after { border-radius: 6px 0 0 0; }
.orgtree ul ul::before { content: ''; position: absolute; top: 0; left: 50%; border-left: 2px solid #cfe3dc; width: 0; height: 22px; }
.orgtree > ul { padding-top: 0; }
.orgtree > ul > li { padding-top: 0; }
.orgtree > ul > li::before, .orgtree > ul > li::after { display: none; }
.oc-card { display: inline-flex; flex-direction: column; gap: 3px; border: 2px solid; border-radius: 12px; padding: 8px 12px; min-width: 158px; max-width: 220px; box-shadow: 0 1px 2px rgba(11,46,32,0.06); }
.oc-name { font-weight: 600; font-size: 13px; color: #0b2e22; line-height: 1.2; }
.oc-sub { font-size: 11px; color: #5b7a70; line-height: 1.25; }
.oc-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 2px; }
.oc-chip { border-radius: 999px; padding: 1px 7px; font-size: 10px; font-weight: 600; }
.oc-toggle { border: 1px solid #cfe3dc; border-radius: 6px; background: #fff; font-size: 10px; font-weight: 700; color: #2e6f47; padding: 0 6px; line-height: 16px; min-width: 22px; }
.oc-edit { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; border-top: 1px dashed #cfe3dc; padding-top: 5px; }
.oc-edit label { display: flex; flex-direction: column; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; color: #5b7a70; gap: 2px; }
.oc-edit select { font-size: 11px; border: 1px solid #cfe3dc; border-radius: 6px; padding: 2px 4px; color: #0b2e22; background: #fff; max-width: 190px; }
`;
