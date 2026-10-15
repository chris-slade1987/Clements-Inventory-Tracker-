"use client";

import { useMemo, useState } from "react";
import {
  LEVELS, MODULES, DEFAULT_GRANTS, isVeItem,
  type Grants,
} from "@/lib/access-catalog";

type UserRow = { id: string; name: string; email: string; level: string; branch: string | null };

const norm = (v: Grants[string] | undefined) => (v === undefined ? false : v);
const truthy = (v: Grants[string] | undefined) => !!v;
const stripFalse = (g: Grants): Grants =>
  Object.fromEntries(Object.entries(g).filter(([, v]) => v !== false)) as Grants;
const levelName = (k: string) => LEVELS.find((l) => l.key === k)?.name ?? k;

export default function AccessRightsClient({
  levelGrants: initialLevels,
  overrides: initialOverrides,
  users,
}: {
  levelGrants: Record<string, Grants>;
  overrides: Record<string, Grants>;
  users: UserRow[];
  me: string;
}) {
  const [levelState, setLevelState] = useState<Record<string, Grants>>(initialLevels);
  const [overrideState, setOverrideState] = useState<Record<string, Grants>>(initialOverrides);
  const [mode, setMode] = useState<"levels" | "users">("levels");
  const [levelKey, setLevelKey] = useState<string>("manager");
  const [userId, setUserId] = useState<string>(users[0]?.id ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Grants>({});
  const [open, setOpen] = useState<Record<string, boolean>>({ mybranch: true });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const selectedUser = users.find((u) => u.id === userId);
  const userBaseLevel = selectedUser?.level ?? "employee";

  // The grants currently shown (base for the selection) when not editing.
  const base: Grants = useMemo(() => {
    if (mode === "levels") return levelState[levelKey] ?? {};
    return { ...(levelState[userBaseLevel] ?? {}), ...(overrideState[userId] ?? {}) };
  }, [mode, levelKey, userBaseLevel, userId, levelState, overrideState]);

  const view: Grants = editing ? draft : base;
  const metaDesc = mode === "levels" ? LEVELS.find((l) => l.key === levelKey)?.desc ?? "" : "";

  const overrideCount = useMemo(() => {
    if (mode !== "users") return 0;
    const lvl = levelState[userBaseLevel] ?? {};
    const comp = editing ? draft : { ...lvl, ...(overrideState[userId] ?? {}) };
    let n = 0;
    for (const m of MODULES) for (const it of m.items) {
      if (JSON.stringify(norm(comp[it.id])) !== JSON.stringify(norm(lvl[it.id]))) n++;
    }
    return n;
  }, [mode, editing, draft, levelState, overrideState, userBaseLevel, userId]);

  function startEdit() {
    setDraft({ ...base });
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft({});
  }
  function resetToLevel() {
    setDraft({ ...(levelState[userBaseLevel] ?? {}) });
    setToast("Reset to level default (unsaved)");
  }
  function setItem(id: string, value: Grants[string] | undefined) {
    setDraft((d) => {
      const next = { ...d };
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });
  }
  function toggleAccess(id: string, checked: boolean) {
    setItem(id, checked ? true : false);
  }
  function toggleView(id: string, checked: boolean) {
    if (checked) setItem(id, view[id] === "edit" ? "edit" : "view");
    else setItem(id, false);
  }
  function toggleEdit(id: string, checked: boolean) {
    setItem(id, checked ? "edit" : "view");
  }

  async function save() {
    setSaving(true);
    try {
      let payload: Record<string, unknown>;
      if (mode === "levels") {
        payload = { scope: "level", key: levelKey, grants: stripFalse(draft) };
      } else {
        const lvl = levelState[userBaseLevel] ?? {};
        const ovr: Grants = {};
        for (const m of MODULES) for (const it of m.items) {
          if (JSON.stringify(norm(draft[it.id])) !== JSON.stringify(norm(lvl[it.id]))) {
            ovr[it.id] = draft[it.id] ?? false;
          }
        }
        payload = { scope: "user", userId, grants: ovr };
      }
      const res = await fetch("/api/settings/access-rights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Save failed");
      }
      if (mode === "levels") {
        setLevelState((s) => ({ ...s, [levelKey]: stripFalse(draft) }));
        setToast("Saved — level default updated.");
      } else {
        const lvl = levelState[userBaseLevel] ?? {};
        const ovr: Grants = {};
        for (const m of MODULES) for (const it of m.items) {
          if (JSON.stringify(norm(draft[it.id])) !== JSON.stringify(norm(lvl[it.id]))) ovr[it.id] = draft[it.id] ?? false;
        }
        setOverrideState((s) => ({ ...s, [userId]: ovr }));
        setToast(`Saved — custom access for ${selectedUser?.name ?? "user"} updated.`);
      }
      setEditing(false);
      setDraft({});
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 2800);
    }
  }

  const levelDefaultForCustom = mode === "users" ? levelState[userBaseLevel] ?? {} : null;

  return (
    <div className="text-ink">
      {/* super-admin banner */}
      <div className="flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 mb-5">
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brand-700" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" />
        </svg>
        <p className="text-sm">
          <span className="font-medium">Super admins only.</span> Editing access rights is restricted to{" "}
          <span className="text-brand-700">Chris Slade, Julie Glanville, April Williford</span>. Everyone else sees it read-only.
        </p>
      </div>

      <div className="mb-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted font-medium">Access control</div>
        <h1 className="text-[26px] font-light tracking-tight mt-0.5">Access Rights</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Set what each access level can see and do by default, or customize a single person without changing their whole level.
        </p>
      </div>

      {/* tabs */}
      <div className="inline-flex gap-0.5 rounded-full bg-black/[0.06] p-1 mb-5">
        {(["levels", "users"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { if (editing) cancelEdit(); setMode(t); }}
            className={`px-4 py-2 rounded-full text-sm ${mode === t ? "bg-surface text-ink font-medium shadow-sm" : "text-muted"}`}
          >
            {t === "levels" ? "Access Levels · defaults" : "Individual Users"}
          </button>
        ))}
      </div>

      {/* control card */}
      <div className="rounded-xl border border-line bg-surface shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-center gap-4">
          {mode === "levels" ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">Access level</span>
              <select
                value={levelKey}
                onChange={(e) => { if (editing) cancelEdit(); setLevelKey(e.target.value); }}
                className="min-w-[220px] rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              >
                {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">Employee</span>
                <select
                  value={userId}
                  onChange={(e) => { if (editing) cancelEdit(); setUserId(e.target.value); }}
                  className="min-w-[240px] rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                >
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.branch ?? "—"}</option>)}
                </select>
              </label>
              <span className="rounded-full bg-brand-50 border border-brand-100 text-brand-700 text-xs font-medium px-3 py-1">
                {levelName(userBaseLevel)} default
              </span>
              <span className="text-xs text-muted">
                {overrideCount > 0
                  ? <><b className="text-[#8a6410] font-semibold">{overrideCount}</b> custom change{overrideCount > 1 ? "s" : ""} vs level default</>
                  : "No custom changes — inherits level default"}
              </span>
            </>
          )}
          {metaDesc && <span className="text-sm text-muted flex-1 min-w-[180px]">{metaDesc}</span>}
          <div className="flex-1" />
          {!editing ? (
            <button onClick={startEdit} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7}><path d="M4 20h4L18 10l-4-4L4 16z" /><path d="M13 7l4 4" /></svg>
              Modify
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white bg-emerald-grad disabled:opacity-50">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 13l4 4L19 7" /></svg>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button onClick={cancelEdit} className="rounded-lg px-4 py-2 text-sm font-medium text-muted">Cancel</button>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 mb-4">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M4 20h4L18 10l-4-4L4 16z" /><path d="M13 7l4 4" /></svg>
          {mode === "levels"
            ? <span>Editing the <b>{levelName(levelKey)}</b> default — changes apply to everyone at this level.</span>
            : <span>Customizing <b>{selectedUser?.name}</b> only — the <b>{levelName(userBaseLevel)}</b> default is unchanged.</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <button onClick={() => setOpen(Object.fromEntries(MODULES.map((m) => [m.id, true])))} className="text-[12.5px] text-brand-700 font-medium px-1.5 py-1">Expand all</button>
        <button onClick={() => setOpen({})} className="text-[12.5px] text-brand-700 font-medium px-1.5 py-1">Collapse all</button>
        {editing && mode === "users" && (
          <button onClick={resetToLevel} className="text-[12.5px] text-brand-700 font-medium px-1.5 py-1">Reset to level default</button>
        )}
      </div>

      {/* modules */}
      <div className="flex flex-col gap-3">
        {MODULES.map((m) => {
          const granted = m.items.filter((it) => truthy(view[it.id])).length;
          const isOpen = !!open[m.id];
          return (
            <div key={m.id} className="rounded-xl border border-line bg-surface shadow-sm overflow-hidden">
              <button onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
                <svg viewBox="0 0 24 24" className={`h-4 w-4 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.7}><path d="M9 6l6 6-6 6" /></svg>
                <span>
                  <span className="block text-[15px] font-medium">{m.name}</span>
                  <span className="block text-xs text-muted">{m.sub}</span>
                </span>
                <span className="ml-auto text-xs tabular-nums rounded-full bg-brand-50 border border-brand-100 text-brand-700 px-2.5 py-0.5">{granted} / {m.items.length}</span>
              </button>
              {isOpen && (
                <div className="border-t border-line">
                  {m.items.map((it) => {
                    const v = view[it.id];
                    const custom = mode === "users" && levelDefaultForCustom
                      && JSON.stringify(norm(v)) !== JSON.stringify(norm(levelDefaultForCustom[it.id]));
                    const viewChecked = it.ve ? (v === "view" || v === "edit") : !!v;
                    const editChecked = v === "edit";
                    return (
                      <div key={it.id} className={`flex items-center gap-3 border-t border-line first:border-t-0 pl-11 pr-4 py-2.5 ${custom ? "bg-amber-50/60" : ""}`}>
                        <div className="min-w-0">
                          <span className="text-sm">{it.name}</span>
                          {it.note && <span className="text-[11.5px] text-muted"> · {it.note}</span>}
                        </div>
                        <div className="ml-auto flex items-center gap-5 shrink-0">
                          {custom && <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-[#8a6410] bg-[#fdf1d0] border border-[#f0dca6] rounded-full px-2 py-0.5">Custom</span>}
                          {isVeItem(it.id) ? (
                            <>
                              <label className="inline-flex items-center gap-2 text-[12.5px] text-muted min-w-[58px]">
                                <input type="checkbox" className="h-[18px] w-[18px] accent-[#2e6f47]" disabled={!editing} checked={viewChecked} onChange={(e) => toggleView(it.id, e.target.checked)} />
                                View
                              </label>
                              <label className="inline-flex items-center gap-2 text-[12.5px] text-muted min-w-[58px]">
                                <input type="checkbox" className="h-[18px] w-[18px] accent-[#2e6f47]" disabled={!editing} checked={editChecked} onChange={(e) => toggleEdit(it.id, e.target.checked)} />
                                Edit
                              </label>
                            </>
                          ) : (
                            <label className="inline-flex items-center gap-2 text-[12.5px] text-muted">
                              <input type="checkbox" className="h-[18px] w-[18px] accent-[#2e6f47]" disabled={!editing} checked={!!v} onChange={(e) => toggleAccess(it.id, e.target.checked)} />
                              Access
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted mt-5 border-t border-dashed border-line pt-3.5 leading-relaxed">
        Checked boxes reflect each level&apos;s current access. Changing a level&apos;s default affects everyone at that level; an
        individual override changes only that person. Enforcement is being wired into each screen deliberately so no one is
        locked out by a mismatch — until then, existing page guards stay in place as the safety net.
      </p>

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 bg-forest text-white px-4 py-2.5 rounded-lg text-sm shadow-lg z-50">{toast}</div>
      )}
    </div>
  );
}
