"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { btn, Spinner } from "@/components/ui";

// Shared Org Chart (Round 4) — the company reporting chart of employee cards,
// laid out as a TOP-DOWN FAMILY TREE: each person's direct reports sit side by
// side beneath them, joined by pure-CSS connectors, branching out across the
// width of the screen (no sideways sliding in the default view — large teams
// collapse to a chip, and phones fall back to a vertical indented stack).
//
// Each card is COLLAPSED by default (name, title, branch, route). An "Expand"
// control reveals the saved info (certs, approved services, corporate role /
// who-to-go-to, scheduling, latest note); inside the expanded view an "Edit"
// button opens the inline editor. Editing is open to every staff member EXCEPT
// field technicians (and read-only board observers) — enforced here by the
// `canEditAll` flag and re-checked server-side in `updateTileFields`.
//
// Consumed by the universal Company → Org Chart page (/org) and the HR console
// (/management/people/org).

// ---- Types (structural copies of lib/org-chart's payload; that module is
//      server-only, so the client re-declares the plain JSON shape). ----------
export type OrgTileCert = { code: string; name: string; awardedAt: string };
export type OrgTileNote = {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
};
export type OrgTile = {
  id: string;
  name: string;
  title: string | null;
  role: string | null;
  branch: string | null;
  branchLabel: string | null;
  reportsToId: string | null;
  routeNumber: string | null;
  certifications: OrgTileCert[];
  approvedServices: { key: string; label: string }[];
  serviceNotes: string | null;
  serviceSchedulingNote: string | null;
  personalSchedulingNote: string | null;
  roleResponsibilities: string | null;
  contactReasons: string | null;
  contactGuidance: string | null;
  accessLevel: string | null;
  latestNotes: OrgTileNote[];
};
export type OrgTreeNode = OrgTile & { reports: OrgTreeNode[] };

// Tile color coding by access level (matches the legacy Structure & access view).
const LEVEL_STYLE: Record<string, { border: string; bg: string; chip: string; label: string }> = {
  super_admin: { border: "#059669", bg: "#ecfdf5", chip: "bg-emerald-100 text-emerald-800", label: "Super Admin" },
  admin: { border: "#0284c7", bg: "#eff6ff", chip: "bg-sky-100 text-sky-800", label: "Admin" },
  manager: { border: "#d97706", bg: "#fffbeb", chip: "bg-amber-100 text-amber-800", label: "Manager" },
  sales_director: { border: "#4f46e5", bg: "#eef2ff", chip: "bg-indigo-100 text-indigo-800", label: "Sales Director" },
  csr: { border: "#7c3aed", bg: "#f5f3ff", chip: "bg-violet-100 text-violet-800", label: "CSR" },
  sales: { border: "#db2777", bg: "#fdf2f8", chip: "bg-pink-100 text-pink-800", label: "Service Advisor" },
  technician: { border: "#94a3b8", bg: "#f8fafc", chip: "bg-slate-100 text-slate-700", label: "Technician" },
};
const NO_LEVEL = { border: "#cbd5e1", bg: "#ffffff", chip: "bg-black/5 text-muted", label: "No login" };
const styleForLevel = (lvl: string | null) => (lvl && LEVEL_STYLE[lvl]) || NO_LEVEL;
// Legend order (only levels actually present are shown).
const LEVEL_ORDER = ["super_admin", "admin", "manager", "sales_director", "csr", "sales", "technician"];

type Tag = { key: string; label: string };

export type OrgChartProps = {
  roots: OrgTreeNode[];
  tiles: OrgTile[];
  serviceTags: Tag[];
  branches: Tag[];
  /** True when the viewer may edit cards (every non-technician staff member). */
  canEditAll?: boolean;
  /** Retained for the call sites; no longer scopes editing to one branch. */
  editBranch?: string | null;
  /** When set, the name + "full notes" link point at `${profileBase}/<id>`. */
  profileBase?: string | null;
  /** True for super admins (Chris / Julie / April) — unlocks "Edit structure"
   *  mode to move people to a new supervisor (updates their profile + team). */
  canReassign?: boolean;
  /** Employee ids that sit at the very top of the company (CEO / President) — they
   *  legitimately have no supervisor, so they're never flagged "No supervisor". */
  topLevelIds?: string[];
};

// ---- Small helpers ---------------------------------------------------------
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const abs = Math.abs(diffMs);
  const min = 60_000, hr = 3_600_000, day = 86_400_000;
  if (abs < 45_000) return "just now";
  if (abs < hr) return `${Math.round(abs / min)}m ago`;
  if (abs < day) return `${Math.round(abs / hr)}h ago`;
  if (abs < 7 * day) return `${Math.round(abs / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const ICON = {
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.3-4.3",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
  cert: "M12 15a4 4 0 100-8 4 4 0 000 8zm0 0l-2.5 5 2.5-1.3L14.5 20 12 15",
  route: "M6 19a2 2 0 100-4 2 2 0 000 4zm12-10a2 2 0 100-4 2 2 0 000 4zM8 17h7a3 3 0 003-3V9M6 15V8",
  note: "M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM14 3v5h5M9 13h6M9 17h4",
  clock: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  collapse: "M5 12h14",
  expand: "M12 5v14M5 12h14",
  chevron: "M6 9l6 6 6-6",
  phone: "M4 4h4l2 5-2.5 1.5a11 11 0 006 6L15 14l5 2v4a1 1 0 01-1 1A16 16 0 013 5a1 1 0 011-1z",
  help: "M12 17h.01M12 14a2 2 0 00.4-3.96A2.5 2.5 0 109.6 8.5M12 21a9 9 0 110-18 9 9 0 010 18z",
  role: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0",
  move: "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20",
  palette: "M12 3a9 9 0 100 18h1.5a2.5 2.5 0 002.5-2.5 2 2 0 012-2H20a2 2 0 002-2 7 7 0 00-7-7zM7.5 11a1 1 0 110-2 1 1 0 010 2zm3-4a1 1 0 110-2 1 1 0 010 2zm5 0a1 1 0 110-2 1 1 0 010 2z",
  warn: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  close: "M18 6 6 18M6 6l12 12",
};

// Split a multiline bullet field into clean bullet strings (strips any leading
// "-"/"•" the author typed). One line → render as a paragraph instead.
function toBullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*[-•·*]\s*/, "").trim())
    .filter(Boolean);
}

function BulletList({ text }: { text: string }) {
  const items = toBullets(text);
  if (items.length <= 1) return <p className="oct-roletext">{items[0] ?? text}</p>;
  return (
    <ul className="oct-bullets">
      {items.map((b, i) => <li key={i}>{b}</li>)}
    </ul>
  );
}

// Collect the descendant ids of a node (for collapse-all seeding).
function collectInners(nodes: OrgTreeNode[], out: Set<string>) {
  for (const n of nodes) {
    if (n.reports.length) {
      out.add(n.id);
      collectInners(n.reports, out);
    }
  }
}

// Scope the tree to a single branch: keep nodes whose branch matches, nesting
// their kept reports beneath them. A matching node whose manager is NOT in the
// branch surfaces as a root of the pruned forest — so selecting "Stuart" shows
// Adam on top with his techs and advisors flowing beneath.
function pruneBranch(nodes: OrgTreeNode[], branch: string): OrgTreeNode[] {
  const out: OrgTreeNode[] = [];
  for (const n of nodes) {
    const keptKids = pruneBranch(n.reports, branch);
    if (n.branch === branch) {
      out.push({ ...n, reports: keptKids });
    } else {
      out.push(...keptKids);
    }
  }
  return out;
}

// Count people in a (possibly pruned) forest.
function countPeople(nodes: OrgTreeNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countPeople(node.reports);
  return n;
}

export default function OrgChart({
  roots,
  tiles,
  serviceTags,
  branches,
  canEditAll = false,
  editBranch = null, // eslint-disable-line @typescript-eslint/no-unused-vars
  profileBase = null,
  canReassign = false,
  topLevelIds = [],
}: OrgChartProps) {
  const router = useRouter();
  // Structure-edit mode (super admins only) + the person currently being moved.
  const [editStructure, setEditStructure] = useState(false);
  const [moveFor, setMoveFor] = useState<OrgTile | null>(null);
  // Color the tiles by access level (on by default — the directory reads at a glance).
  const [colorByLevel, setColorByLevel] = useState(true);

  // Live tile state so an edit reflects everywhere (tree + search) instantly.
  const [tilesById, setTilesById] = useState<Map<string, OrgTile>>(() => new Map(tiles.map((t) => [t.id, t])));
  useEffect(() => {
    setTilesById(new Map(tiles.map((t) => [t.id, t])));
  }, [tiles]);

  const liveTile = useCallback((t: OrgTile) => tilesById.get(t.id) ?? t, [tilesById]);
  // Every non-technician staff member may edit any card (checked again server-side).

  // Team collapse state — collapse large sub-teams (>5 reports) by default so the
  // tree fits the screen width without sideways scrolling.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    const walk = (nodes: OrgTreeNode[]) => {
      for (const n of nodes) {
        if (n.reports.length > 5) s.add(n.id);
        walk(n.reports);
      }
    };
    walk(roots);
    return s;
  });
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const collapseAll = () => {
    const s = new Set<string>();
    collectInners(roots, s);
    setCollapsed(s);
  };
  const expandAll = () => setCollapsed(new Set());

  // Per-card detail expand state (separate from the team collapse above).
  const [expandedCards, setExpandedCards] = useState<Set<string>>(() => new Set());
  const toggleCard = (id: string) =>
    setExpandedCards((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // --- Search + filters (wired to /api/org) ---------------------------------
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [service, setService] = useState("");
  const [results, setResults] = useState<OrgTile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const textSearch = query.trim().length > 0 || !!service;
  const branchOnly = !textSearch && !!branch;

  useEffect(() => {
    if (!textSearch) {
      abortRef.current?.abort();
      setResults(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (branch) params.set("branch", branch);
        if (service) params.set("service", service);
        const res = await fetch(`/api/org?${params.toString()}`, { signal: ac.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Search failed.");
        const mapped: OrgTile[] = (data.results ?? []).map((r: OrgTile) => tilesById.get(r.id) ?? r);
        setResults(mapped);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setSearchError((e as Error).message || "Search failed.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, branch, service, textSearch]);

  const clearSearch = () => {
    setQuery("");
    setBranch("");
    setService("");
  };

  // --- Tile editor ----------------------------------------------------------
  const [editingId, setEditingId] = useState<string | null>(null);

  const totalPeople = tiles.length;

  // Structure maps (from the `tiles` prop, refreshed after a move): id→name,
  // each person's descendant set (to block cycles in the move picker), and who
  // currently has no valid supervisor (null, or a manager not in the active set).
  const { nameById, descById, noSupervisorIds } = useMemo(() => {
    const ids = new Set(tiles.map((t) => t.id));
    const nameById = new Map(tiles.map((t) => [t.id, t.name]));
    const kids = new Map<string, string[]>();
    for (const t of tiles) {
      if (t.reportsToId && ids.has(t.reportsToId)) {
        const a = kids.get(t.reportsToId) ?? [];
        a.push(t.id);
        kids.set(t.reportsToId, a);
      }
    }
    const descById = new Map<string, Set<string>>();
    const descend = (id: string): Set<string> => {
      if (descById.has(id)) return descById.get(id)!;
      const out = new Set<string>();
      descById.set(id, out); // guard against cycles while building
      for (const c of kids.get(id) ?? []) {
        out.add(c);
        for (const d of descend(c)) out.add(d);
      }
      return out;
    };
    for (const t of tiles) descend(t.id);
    // The CEO / President sit at the top with no supervisor by design — never flag them.
    const topSet = new Set(topLevelIds);
    const noSupervisorIds = new Set(
      tiles.filter((t) => !topSet.has(t.id) && (!t.reportsToId || !ids.has(t.reportsToId))).map((t) => t.id),
    );
    return { nameById, descById, noSupervisorIds };
  }, [tiles, topLevelIds]);

  const visibleRoots = branchOnly ? pruneBranch(roots, branch) : roots;
  const visibleCount = branchOnly ? countPeople(visibleRoots) : totalPeople;
  const branchLabel = branchOnly ? branches.find((b) => b.key === branch)?.label ?? null : null;
  const unassignedCount = noSupervisorIds.size;
  const presentLevels = LEVEL_ORDER.filter((l) => tiles.some((t) => t.accessLevel === l));
  const hasNoLogin = tiles.some((t) => !t.accessLevel);

  const cardProps = (t: OrgTile) => ({
    tile: liveTile(t),
    editable: canEditAll,
    expanded: expandedCards.has(t.id),
    onToggleExpand: () => toggleCard(t.id),
    editing: editingId === t.id,
    onEdit: () => { setExpandedCards((c) => new Set(c).add(t.id)); setEditingId(t.id); },
    onCancel: () => setEditingId(null),
    onSaved: (updated: OrgTile) => {
      setTilesById((m) => new Map(m).set(updated.id, updated));
      setEditingId(null);
    },
    serviceTags,
    profileBase,
    colored: colorByLevel,
    // Structure-edit affordances (super admins only, when edit mode is on).
    reassignable: canReassign && editStructure,
    needsSupervisor: noSupervisorIds.has(t.id),
    managerName: t.reportsToId ? nameById.get(t.reportsToId) ?? null : null,
    onReassign: () => setMoveFor(liveTile(t)),
  });

  return (
    <div>
      <style>{CSS}</style>

      {/* Search + filters */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search the org chart by name, route number, service, or branch</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <Icon path={ICON.search} className="h-4 w-4" />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, route number, service, branch…"
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
        </label>
        <select
          value={branch}
          onChange={(e) => {
            setBranch(e.target.value);
            setCollapsed(new Set());
          }}
          aria-label="Filter by branch"
          className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.key} value={b.key}>{b.label}</option>
          ))}
        </select>
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          aria-label="Filter by approved service"
          className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <option value="">All services</option>
          {serviceTags.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        {textSearch || branch ? (
          <button type="button" onClick={clearSearch} className={`${btn.secondary} py-2.5`}>Clear</button>
        ) : null}
      </div>

      {/* Chart controls (tree only) */}
      {!textSearch ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            {branchLabel ? `${branchLabel} — ` : ""}{visibleCount} {visibleCount === 1 ? "person" : "people"} · tap <span className="font-medium">Expand</span> on a card for details, or a lead&apos;s <span className="font-medium">report</span> toggle to open their team.
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setColorByLevel((v) => !v)}
              aria-pressed={colorByLevel}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${colorByLevel ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line bg-surface text-ink hover:border-brand-300"}`}
            >
              <Icon path={ICON.palette} className="h-3.5 w-3.5" /> Color by level
            </button>
            {canReassign ? (
              <button
                type="button"
                onClick={() => setEditStructure((v) => !v)}
                aria-pressed={editStructure}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${editStructure ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line bg-surface text-ink hover:border-brand-300"}`}
              >
                <Icon path={ICON.move} className="h-3.5 w-3.5" /> {editStructure ? "Done editing" : "Edit structure"}
              </button>
            ) : null}
            <button type="button" onClick={expandAll} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <Icon path={ICON.expand} className="h-3.5 w-3.5" /> Expand all teams
            </button>
            <button type="button" onClick={collapseAll} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <Icon path={ICON.collapse} className="h-3.5 w-3.5" /> Collapse all teams
            </button>
          </div>
        </div>
      ) : null}

      {/* Access-level legend (when coloring is on) */}
      {!textSearch && colorByLevel && (presentLevels.length > 0 || hasNoLogin) ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="font-medium text-ink">Access level:</span>
          {presentLevels.map((l) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: LEVEL_STYLE[l].border }} aria-hidden="true" />
              {LEVEL_STYLE[l].label}
            </span>
          ))}
          {hasNoLogin ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NO_LEVEL.border }} aria-hidden="true" />
              {NO_LEVEL.label}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Edit-structure banner + unassigned-supervisor callout (super admins) */}
      {!textSearch && canReassign && editStructure ? (
        <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-800">
          <span className="font-semibold">Edit structure is on.</span> Tap <span className="font-medium">Change supervisor</span> on anyone&apos;s card to move them — you&apos;ll confirm before it saves, and the move updates that person&apos;s profile (supervisor + team).
          {unassignedCount > 0 ? (
            <span className="ml-1 text-amber-800">{unassignedCount} {unassignedCount === 1 ? "person has" : "people have"} no supervisor yet — look for the amber <span className="font-medium">No supervisor</span> tag.</span>
          ) : null}
        </div>
      ) : !textSearch && unassignedCount > 0 && canReassign ? (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          {unassignedCount} {unassignedCount === 1 ? "person has" : "people have"} no supervisor assigned. Tap <span className="font-medium">Edit structure</span> to place them.
        </div>
      ) : null}

      {/* Search results OR the tree */}
      {textSearch ? (
        <div aria-live="polite">
          {searching && results === null ? (
            <div className="py-10 text-center"><Spinner label="Searching…" /></div>
          ) : searchError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">{searchError}</div>
          ) : results && results.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface px-4 py-10 text-center">
              <div className="font-medium text-ink">No matches</div>
              <div className="mt-1 text-sm text-muted">Try a name, a route number, or a different service / branch.</div>
            </div>
          ) : (
            <>
              <p className="mb-3 text-[11px] text-muted">{results?.length} match{results?.length === 1 ? "" : "es"}{searching ? " · updating…" : ""}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 items-start">
                {results?.map((t) => (
                  <TileCard key={t.id} {...cardProps(t)} />
                ))}
              </div>
            </>
          )}
        </div>
      ) : visibleRoots.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface px-4 py-12 text-center">
          <div className="font-medium text-ink">{branchLabel ? `No one in ${branchLabel} yet` : "No one to chart yet"}</div>
          <div className="mt-1 text-sm text-muted">Employees appear here once they&apos;re added with a reporting line.</div>
        </div>
      ) : (
        <div className="octree-scroll overflow-x-auto pb-4">
          <div className="octree">
            <ul>
              {visibleRoots.map((r) => (
                <TreeNode
                  key={r.id}
                  node={r}
                  collapsed={collapsed}
                  toggle={toggle}
                  cardProps={cardProps}
                />
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Reassign-supervisor modal (super admins, edit mode) */}
      {moveFor ? (
        <ReassignModal
          person={moveFor}
          candidates={tiles}
          excludeIds={new Set([moveFor.id, ...(descById.get(moveFor.id) ?? [])])}
          currentManagerName={moveFor.reportsToId ? nameById.get(moveFor.reportsToId) ?? null : null}
          onClose={() => setMoveFor(null)}
          onSaved={() => {
            setMoveFor(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// ---- Reassign-supervisor modal --------------------------------------------
function ReassignModal({
  person,
  candidates,
  excludeIds,
  currentManagerName,
  onClose,
  onSaved,
}: {
  person: OrgTile;
  candidates: OrgTile[];
  excludeIds: Set<string>;
  currentManagerName: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ id: string | null; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return candidates
      .filter((c) => !excludeIds.has(c.id))
      .filter((c) => {
        if (tokens.length === 0) return true;
        const hay = `${c.name} ${c.title ?? ""} ${c.role ?? ""} ${c.branchLabel ?? ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [candidates, excludeIds, q]);

  async function save() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/reports-to", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: person.id, reportsToId: picked?.id ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save the move.");
      onSaved();
    } catch (e) {
      setError((e as Error).message || "Could not save the move.");
      setBusy(false);
    }
  }

  return (
    <div className="oct-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Move ${person.name}`} onClick={onClose}>
      <div className="oct-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink">Move {person.name}</div>
            <div className="mt-0.5 text-[11px] text-muted">
              Currently reports to <span className="font-medium text-ink">{currentManagerName ?? "— no supervisor —"}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-black/5">
            <Icon path={ICON.close} className="h-4 w-4" />
          </button>
        </div>

        {picked === null ? (
          <>
            <label className="mt-3 block">
              <span className="sr-only">Search for the new supervisor</span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search for the new supervisor…"
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
            </label>
            <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setPicked({ id: null, name: "— Top of org (no supervisor) —" })}
                className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-sm text-ink hover:bg-brand-50"
              >
                <Icon path={ICON.move} className="h-3.5 w-3.5 text-muted" />
                <span className="font-medium">Top of org</span><span className="text-[11px] text-muted">— no supervisor</span>
              </button>
              {list.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-muted">No match. Everyone on {person.name}&apos;s own team is hidden (that would make a loop).</div>
              ) : (
                list.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setPicked({ id: c.id, name: c.name })}
                    className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{c.name}</span>
                      <span className="block truncate text-[11px] text-muted">{[c.title || c.role, c.branchLabel].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="mt-3">
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-3 text-sm text-ink">
              Move <span className="font-semibold">{person.name}</span> to report to{" "}
              <span className="font-semibold">{picked.name}</span>?
              <div className="mt-1 text-[11px] text-muted">This updates {person.name}&apos;s profile — their supervisor and the team they&apos;re on will change right away.</div>
            </div>
            {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={save} disabled={busy} className={`${btn.primary} px-3 py-1.5 text-xs`}>
                {busy ? "Saving…" : "Save changes"}
              </button>
              <button type="button" onClick={() => { setPicked(null); setError(null); }} disabled={busy} className={`${btn.secondary} px-3 py-1.5 text-xs`}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Tree node (recursive) -------------------------------------------------
function TreeNode({
  node,
  collapsed,
  toggle,
  cardProps,
}: {
  node: OrgTreeNode;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  cardProps: (t: OrgTile) => Omit<Parameters<typeof TileCard>[0], "footer">;
}) {
  const kids = node.reports;
  const isCollapsed = collapsed.has(node.id);
  return (
    <li>
      <div className="octree-node">
        <TileCard
          {...cardProps(node)}
          footer={
            kids.length ? (
              <button
                type="button"
                onClick={() => toggle(node.id)}
                aria-expanded={!isCollapsed}
                className="mt-1 inline-flex items-center gap-1 self-center rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-brand-700 hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Icon path={isCollapsed ? ICON.expand : ICON.collapse} className="h-3 w-3" />
                {isCollapsed ? `${kids.length} report${kids.length > 1 ? "s" : ""}` : "Hide team"}
              </button>
            ) : null
          }
        />
      </div>
      {kids.length && !isCollapsed ? (
        <ul>
          {kids.map((k) => (
            <TreeNode key={k.id} node={k} collapsed={collapsed} toggle={toggle} cardProps={cardProps} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ---- A single employee card ------------------------------------------------
function TileCard({
  tile,
  editable,
  expanded,
  onToggleExpand,
  editing,
  onEdit,
  onCancel,
  onSaved,
  serviceTags,
  profileBase,
  colored = false,
  reassignable = false,
  needsSupervisor = false,
  managerName = null,
  onReassign,
  footer,
}: {
  tile: OrgTile;
  editable: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (t: OrgTile) => void;
  serviceTags: Tag[];
  profileBase: string | null;
  colored?: boolean;
  reassignable?: boolean;
  needsSupervisor?: boolean;
  managerName?: string | null;
  onReassign?: () => void;
  footer?: ReactNode;
}) {
  const lvl = styleForLevel(tile.accessLevel);
  const profileHref = profileBase ? `${profileBase}/${tile.id}` : null;
  const latest = tile.latestNotes[0];
  const sched = tile.serviceSchedulingNote || tile.personalSchedulingNote;

  const hasDetail =
    tile.certifications.length > 0 ||
    tile.approvedServices.length > 0 ||
    !!tile.roleResponsibilities ||
    !!tile.contactReasons ||
    !!tile.contactGuidance ||
    !!tile.serviceNotes ||
    !!sched ||
    !!latest;

  // Show the expand control if there's anything to reveal, or the viewer may add it.
  const showExpand = hasDetail || editable;
  const isOpen = expanded || editing;

  return (
    <div
      className={`oct-tile${isOpen ? " oct-tile-open" : ""}`}
      style={colored ? { borderColor: lvl.border, borderLeftWidth: 4, background: lvl.bg } : undefined}
    >
      {/* Header — name with the route number right beside it */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {profileHref ? (
            <Link href={profileHref} className="oct-name hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
              {tile.name}
            </Link>
          ) : (
            <span className="oct-name">{tile.name}</span>
          )}
          {tile.routeNumber ? (
            <span className="oct-route" title="Route number">
              <Icon path={ICON.route} className="h-3 w-3" /> Route {tile.routeNumber}
            </span>
          ) : null}
          {needsSupervisor ? (
            <span className="oct-nosup" title="This person has no supervisor assigned">
              <Icon path={ICON.warn} className="h-3 w-3" /> No supervisor
            </span>
          ) : null}
        </div>
        <div className="oct-sub">{[tile.title || tile.role, tile.branchLabel].filter(Boolean).join(" · ") || "—"}</div>
        {colored ? (
          <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${lvl.chip}`}>{lvl.label}</span>
        ) : null}
        {reassignable ? (
          <div className="oct-sub mt-0.5">Reports to: <span className="font-medium text-ink">{managerName ?? "— no supervisor —"}</span></div>
        ) : null}
      </div>

      {/* Reassign supervisor (super admins, edit-structure mode) */}
      {reassignable ? (
        <button
          type="button"
          onClick={onReassign}
          className="mt-2 inline-flex items-center gap-1 self-start rounded-lg border border-brand-300 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Icon path={ICON.move} className="h-3 w-3" /> Change supervisor
        </button>
      ) : null}

      {/* Expand / collapse the saved info */}
      {showExpand ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={isOpen}
          className="oct-expand"
        >
          <Icon path={ICON.chevron} className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          {isOpen ? "Collapse" : "Expand"}
          {!isOpen && !hasDetail ? <span className="oct-expand-hint">add info</span> : null}
        </button>
      ) : null}

      {/* Expanded detail */}
      {isOpen ? (
        <div className="oct-detail">
          {!hasDetail && !editing ? (
            <p className="text-[11px] italic text-muted">No details saved yet.</p>
          ) : null}

          {/* Certifications */}
          {tile.certifications.length ? (
            <div>
              <div className="oct-label">Certifications</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {tile.certifications.map((c) => (
                  <span key={c.code} className="oct-chip oct-chip-cert" title={`${c.name} · earned ${new Date(c.awardedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`}>
                    <Icon path={ICON.cert} className="h-3 w-3" /> {c.code}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Approved services */}
          {tile.approvedServices.length ? (
            <div>
              <div className="oct-label">Approved to do</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {tile.approvedServices.map((s) => (
                  <span key={s.key} className="oct-chip">{s.label}</span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Corporate role — what they do */}
          {tile.roleResponsibilities ? (
            <div>
              <div className="oct-label"><Icon path={ICON.role} className="mr-1 inline h-3 w-3 -translate-y-px" />What they do</div>
              <div className="mt-0.5"><BulletList text={tile.roleResponsibilities} /></div>
            </div>
          ) : null}

          {/* Corporate role — when to go to them */}
          {tile.contactReasons ? (
            <div>
              <div className="oct-label"><Icon path={ICON.help} className="mr-1 inline h-3 w-3 -translate-y-px" />When to go to them</div>
              <div className="mt-0.5"><BulletList text={tile.contactReasons} /></div>
            </div>
          ) : null}

          {/* How to reach them */}
          {tile.contactGuidance ? (
            <div className="oct-contact">
              <Icon path={ICON.phone} className="mt-px h-3 w-3 shrink-0" />
              <span>{tile.contactGuidance}</span>
            </div>
          ) : null}

          {/* Service notes */}
          {tile.serviceNotes ? (
            <p className="text-[11px] leading-snug text-muted">{tile.serviceNotes}</p>
          ) : null}

          {/* Scheduling (amber) */}
          {sched ? (
            <div className="oct-sched">
              {tile.serviceSchedulingNote ? (
                <div><span className="oct-sched-label">Service scheduling</span> {tile.serviceSchedulingNote}</div>
              ) : null}
              {tile.personalSchedulingNote ? (
                <div className={tile.serviceSchedulingNote ? "mt-1" : ""}><span className="oct-sched-label">Personal</span> {tile.personalSchedulingNote}</div>
              ) : null}
            </div>
          ) : null}

          {/* Latest note */}
          {latest ? (
            <div className="oct-note">
              <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                <Icon path={ICON.note} className="h-3 w-3" /> Latest note
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink">{latest.body}</p>
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
                <span className="font-medium">{latest.authorName}</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-0.5"><Icon path={ICON.clock} className="h-2.5 w-2.5" />{relTime(latest.createdAt)}</span>
              </div>
              {profileHref ? (
                <Link href={`${profileHref}#employee-notes`} className="mt-0.5 inline-block text-[10px] font-medium text-brand-700 hover:underline">
                  Full note log →
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* Edit affordance — inside the expanded view, non-technicians only */}
          {editable && !editing ? (
            <button
              type="button"
              onClick={onEdit}
              className="mt-1 inline-flex items-center gap-1 self-start rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Icon path={ICON.edit} className="h-3 w-3" /> Edit details
            </button>
          ) : null}

          {editing ? (
            <TileEditor tile={tile} serviceTags={serviceTags} onCancel={onCancel} onSaved={onSaved} />
          ) : null}
        </div>
      ) : null}

      {footer}
    </div>
  );
}

// ---- Inline tile editor ----------------------------------------------------
function TileEditor({
  tile,
  serviceTags,
  onCancel,
  onSaved,
}: {
  tile: OrgTile;
  serviceTags: Tag[];
  onCancel: () => void;
  onSaved: (t: OrgTile) => void;
}) {
  const [routeNumber, setRouteNumber] = useState(tile.routeNumber ?? "");
  const [services, setServices] = useState<Set<string>>(() => new Set(tile.approvedServices.map((s) => s.key)));
  const [roleResponsibilities, setRoleResponsibilities] = useState(tile.roleResponsibilities ?? "");
  const [contactReasons, setContactReasons] = useState(tile.contactReasons ?? "");
  const [contactGuidance, setContactGuidance] = useState(tile.contactGuidance ?? "");
  const [serviceNotes, setServiceNotes] = useState(tile.serviceNotes ?? "");
  const [serviceSchedulingNote, setServiceSchedulingNote] = useState(tile.serviceSchedulingNote ?? "");
  const [personalSchedulingNote, setPersonalSchedulingNote] = useState(tile.personalSchedulingNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleService = (key: string) =>
    setServices((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/tile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: tile.id,
          routeNumber: routeNumber.trim() || null,
          approvedServices: [...services],
          roleResponsibilities: roleResponsibilities.trim() || null,
          contactReasons: contactReasons.trim() || null,
          contactGuidance: contactGuidance.trim() || null,
          serviceNotes: serviceNotes.trim() || null,
          serviceSchedulingNote: serviceSchedulingNote.trim() || null,
          personalSchedulingNote: personalSchedulingNote.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save.");
      onSaved(data.tile as OrgTile);
    } catch (e) {
      setError((e as Error).message || "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="oct-editor" role="group" aria-label={`Edit ${tile.name}`}>
      <label className="oct-field">
        <span className="oct-label">Route number</span>
        <input
          value={routeNumber}
          onChange={(e) => setRouteNumber(e.target.value)}
          placeholder="e.g. 42"
          className="oct-input"
        />
      </label>

      <div className="oct-field">
        <span className="oct-label">Approved to do</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {serviceTags.map((s) => {
            const on = services.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleService(s.key)}
                aria-pressed={on}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line bg-surface text-muted hover:border-brand-300"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="oct-field">
        <span className="oct-label">What they do (one per line)</span>
        <textarea value={roleResponsibilities} onChange={(e) => setRoleResponsibilities(e.target.value)} rows={3} className="oct-input" placeholder="Oversees branch operations&#10;Runs weekly check-ins" />
      </label>

      <label className="oct-field">
        <span className="oct-label">When to go to them (one per line)</span>
        <textarea value={contactReasons} onChange={(e) => setContactReasons(e.target.value)} rows={3} className="oct-input" placeholder="Payroll questions&#10;PTO / time-off requests" />
      </label>

      <label className="oct-field">
        <span className="oct-label">How to reach them</span>
        <input value={contactGuidance} onChange={(e) => setContactGuidance(e.target.value)} className="oct-input" placeholder="Email unless urgent · Office ext. 106" />
      </label>

      <label className="oct-field">
        <span className="oct-label">Service notes</span>
        <textarea value={serviceNotes} onChange={(e) => setServiceNotes(e.target.value)} rows={2} className="oct-input" placeholder="What they're approved/known for" />
      </label>

      <label className="oct-field">
        <span className="oct-label">Service scheduling rule</span>
        <textarea value={serviceSchedulingNote} onChange={(e) => setServiceSchedulingNote(e.target.value)} rows={2} className="oct-input" placeholder="Per-service scheduling guidance" />
      </label>

      <label className="oct-field">
        <span className="oct-label">Personal scheduling rule</span>
        <textarea value={personalSchedulingNote} onChange={(e) => setPersonalSchedulingNote(e.target.value)} rows={2} className="oct-input" placeholder="Personal scheduling constraints" />
      </label>

      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}

      <div className="mt-1 flex items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className={`${btn.primary} px-3 py-1.5 text-xs`}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={`${btn.secondary} px-3 py-1.5 text-xs`}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Pure-CSS TOP-DOWN FAMILY TREE: each manager's direct reports sit side by side
// beneath them, joined by connector lines, so the chart branches out across the
// width of the screen. Large teams collapse to a chip by default (so the default
// view fits without sideways sliding); on phones it falls back to a vertical
// indented stack. Namespaced `oct`/`octree`.
const CSS = `
.octree { display: inline-block; min-width: 100%; box-sizing: border-box; }
.octree ul { display: flex; justify-content: center; list-style: none; margin: 0; padding: 0; position: relative; }
.octree li { list-style: none; position: relative; display: flex; flex-direction: column; align-items: center; }

/* Nested (non-root) rows: top padding leaves room for the connector bus. */
.octree ul ul { padding-top: 22px; }
.octree ul ul > li { padding: 22px 10px 0; }

/* Elbow connectors on each child, and the stem from a parent down to the bus. */
.octree ul ul > li::before, .octree ul ul > li::after {
  content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: 22px; border-top: 2px solid #C3DAC9;
}
.octree ul ul > li::after { right: auto; left: 50%; border-left: 2px solid #C3DAC9; }
.octree ul ul > li:only-child::before, .octree ul ul > li:only-child::after { display: none; }
.octree ul ul > li:first-child::before, .octree ul ul > li:last-child::after { border: 0 none; }
.octree ul ul > li:last-child::before { border-right: 2px solid #C3DAC9; border-radius: 0 6px 0 0; }
.octree ul ul > li:first-child::after { border-radius: 6px 0 0 0; }
.octree ul ul::before {
  content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 22px; border-left: 2px solid #C3DAC9;
}

.octree-node { padding: 6px 0 0; display: flex; flex-direction: column; align-items: center; }

/* Phones: fall back to a vertical indented stack (no sideways scroll). */
@media (max-width: 720px) {
  .octree { display: block; }
  .octree ul { flex-direction: column; align-items: stretch; }
  .octree ul ul { padding-top: 0; margin-left: 14px; border-left: 2px solid #C3DAC9; }
  .octree ul ul > li { padding: 10px 0 0 14px; align-items: stretch; }
  .octree ul ul > li::before, .octree ul ul > li::after, .octree ul ul::before { display: none; }
  .octree-node { align-items: stretch; }
}

.oct-tile {
  display: flex; flex-direction: column; width: 244px; max-width: 86vw;
  border: 1px solid #D9DEDA; border-radius: 12px; background: linear-gradient(160deg,#FFFFFF,#F4F6F5);
  padding: 12px; text-align: left;
  box-shadow: 0 1px 2px rgba(8,37,24,.04), 0 14px 30px -24px rgba(8,37,24,.45);
}
.oct-tile-open { border-color: #B6CDBE; box-shadow: 0 1px 2px rgba(8,37,24,.05), 0 18px 38px -22px rgba(8,37,24,.5); }
.oct-name { font-size: 14px; font-weight: 500; color: #0B3D20; line-height: 1.2; }
.oct-sub { font-size: 11px; color: #5C6B62; line-height: 1.3; margin-top: 2px; }
.oct-label { font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #5C6B62; }
.oct-route { display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; border-radius: 999px; background: #1F5836; color: #EEF4F0; font-size: 10px; font-weight: 600; padding: 2px 7px; white-space: nowrap; }
.oct-chip { display: inline-flex; align-items: center; gap: 3px; border-radius: 999px; background: #EEF4F0; color: #1F5836; font-size: 10px; font-weight: 500; padding: 2px 7px; }
.oct-chip-cert { background: #DCE9DF; color: #144229; }
.oct-expand { margin-top: 8px; display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; border-radius: 8px; border: 1px solid #D9DEDA; background: #fff; padding: 3px 8px; font-size: 11px; font-weight: 600; color: #1F5836; }
.oct-expand:hover { border-color: #9FBFA9; }
.oct-expand:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(79,138,95,.35); }
.oct-expand-hint { color: #9aa49d; font-weight: 500; font-style: italic; }
.oct-detail { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.oct-roletext { font-size: 11px; line-height: 1.4; color: #243229; margin: 0; }
.oct-bullets { margin: 0; padding-left: 14px; list-style: disc; display: flex; flex-direction: column; gap: 2px; }
.oct-bullets li { font-size: 11px; line-height: 1.35; color: #243229; }
.oct-contact { display: flex; align-items: flex-start; gap: 5px; border-radius: 8px; background: #EEF4F0; color: #1F5836; font-size: 11px; line-height: 1.35; padding: 6px 8px; }
.oct-sched { border-left: 3px solid #E3B23C; background: #FFFBEB; border-radius: 0 8px 8px 0; padding: 6px 8px; font-size: 11px; line-height: 1.35; color: #7a5a12; }
.oct-sched-label { display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #8F6400; margin-right: 4px; }
.oct-note { border-top: 1px dashed #D9DEDA; padding-top: 6px; display: flex; flex-direction: column; }
.oct-editor { border-top: 1px dashed #D9DEDA; padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.oct-field { display: flex; flex-direction: column; gap: 2px; }
.oct-input { width: 100%; border: 1px solid #D9DEDA; border-radius: 8px; background: #fff; padding: 5px 8px; font-size: 12px; color: #1D2A23; }
.oct-input:focus-visible { outline: none; border-color: #4F8A5F; box-shadow: 0 0 0 2px rgba(79,138,95,.35); }
.oct-nosup { display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; border-radius: 999px; background: #FEF3C7; color: #92400E; font-size: 10px; font-weight: 600; padding: 2px 7px; white-space: nowrap; }
.oct-modal-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(8,37,24,.45); }
.oct-modal { width: 100%; max-width: 420px; max-height: 85vh; overflow: auto; border-radius: 16px; background: #fff; border: 1px solid #D9DEDA; padding: 16px; box-shadow: 0 24px 60px -20px rgba(8,37,24,.6); }
@media (max-width: 720px) { .oct-tile { width: 100%; max-width: 100%; } }
`;
