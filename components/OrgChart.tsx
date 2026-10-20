"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { btn, Spinner } from "@/components/ui";

// Shared Org Chart (Round 2) — the company reporting chart of square employee
// tiles nested under their manager, connected by pure-CSS lines, branches
// collapsible, with a search bar (name · route · service · branch) wired to
// /api/org and branch + service filters. Read-only for everyone; scoped tile
// editing (approved services, service/scheduling notes, route number) for HR /
// leadership / super-admins (anyone) and branch managers (own branch).
//
// Consumed by the universal Company → Org Chart page (/org) and the HR console
// (/management/people/org). No action buttons on tiles (no CRM link) — the name
// and the latest note link to the profile only when the viewer may open it.

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
  latestNotes: OrgTileNote[];
};
export type OrgTreeNode = OrgTile & { reports: OrgTreeNode[] };

type Tag = { key: string; label: string };

export type OrgChartProps = {
  roots: OrgTreeNode[];
  tiles: OrgTile[];
  serviceTags: Tag[];
  branches: Tag[];
  /** HR / senior leadership / super-admins may edit ANY tile. */
  canEditAll?: boolean;
  /** A branch manager may edit only their own branch's tiles (branch key). */
  editBranch?: string | null;
  /** When set, the name + "full notes" link point at `${profileBase}/<id>`. */
  profileBase?: string | null;
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
};

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
// branch (e.g. a branch manager reporting up to Vero leadership) surfaces as a
// root of the pruned forest — so selecting "Stuart" shows Adam on top with his
// techs and advisors flowing beneath, rather than the whole company.
function pruneBranch(nodes: OrgTreeNode[], branch: string): OrgTreeNode[] {
  const out: OrgTreeNode[] = [];
  for (const n of nodes) {
    const keptKids = pruneBranch(n.reports, branch);
    if (n.branch === branch) {
      out.push({ ...n, reports: keptKids });
    } else {
      // Not in the branch — promote any in-branch descendants up a level.
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
  editBranch = null,
  profileBase = null,
}: OrgChartProps) {
  // Live tile state so an edit reflects everywhere (tree + search) instantly.
  const [tilesById, setTilesById] = useState<Map<string, OrgTile>>(() => new Map(tiles.map((t) => [t.id, t])));
  useEffect(() => {
    setTilesById(new Map(tiles.map((t) => [t.id, t])));
  }, [tiles]);

  const liveTile = useCallback((t: OrgTile) => tilesById.get(t.id) ?? t, [tilesById]);
  const canEditTile = useCallback(
    (t: OrgTile) => canEditAll || (!!editBranch && t.branch === editBranch),
    [canEditAll, editBranch],
  );

  // Collapse state — collapse large sub-teams (>5 reports) by default.
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

  // --- Search + filters (wired to /api/org) ---------------------------------
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [service, setService] = useState("");
  const [results, setResults] = useState<OrgTile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Free-text or service filter → a cross-cutting results grid fetched from
  // /api/org (branch, if also set, narrows it). A branch-ONLY selection stays
  // in tree mode, scoped to that branch's subtree.
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
        // Map ids to the live (possibly-edited) tiles so edits stay reflected.
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
    // tilesById intentionally excluded — a tile edit shouldn't re-run the fetch;
    // the live map is read at render time so results stay fresh regardless.
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

  // The tree to render: the full company, or — when a branch alone is picked —
  // that branch's subtree (its manager on top, reports flowing beneath).
  const visibleRoots = branchOnly ? pruneBranch(roots, branch) : roots;
  const visibleCount = branchOnly ? countPeople(visibleRoots) : totalPeople;
  const branchLabel = branchOnly ? branches.find((b) => b.key === branch)?.label ?? null : null;

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
            // Open the chosen branch fully so its whole team is visible at once.
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
            {branchLabel ? `${branchLabel} — ` : ""}{visibleCount} {visibleCount === 1 ? "person" : "people"} · tap a lead&apos;s <span className="font-medium">report</span> toggle to open their team.
          </p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={expandAll} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <Icon path={ICON.expand} className="h-3.5 w-3.5" /> Expand all
            </button>
            <button type="button" onClick={collapseAll} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <Icon path={ICON.collapse} className="h-3.5 w-3.5" /> Collapse all
            </button>
          </div>
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {results?.map((t) => (
                  <TileCard
                    key={t.id}
                    tile={liveTile(t)}
                    editable={canEditTile(t)}
                    editing={editingId === t.id}
                    onEdit={() => setEditingId(t.id)}
                    onCancel={() => setEditingId(null)}
                    onSaved={(updated) => {
                      setTilesById((m) => new Map(m).set(updated.id, updated));
                      setEditingId(null);
                    }}
                    serviceTags={serviceTags}
                    profileBase={profileBase}
                  />
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
                  liveTile={liveTile}
                  canEditTile={canEditTile}
                  editingId={editingId}
                  setEditingId={setEditingId}
                  onSaved={(updated) => {
                    setTilesById((m) => new Map(m).set(updated.id, updated));
                    setEditingId(null);
                  }}
                  serviceTags={serviceTags}
                  profileBase={profileBase}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Tree node (recursive) -------------------------------------------------
function TreeNode({
  node,
  collapsed,
  toggle,
  liveTile,
  canEditTile,
  editingId,
  setEditingId,
  onSaved,
  serviceTags,
  profileBase,
}: {
  node: OrgTreeNode;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  liveTile: (t: OrgTile) => OrgTile;
  canEditTile: (t: OrgTile) => boolean;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onSaved: (t: OrgTile) => void;
  serviceTags: Tag[];
  profileBase: string | null;
}) {
  const kids = node.reports;
  const isCollapsed = collapsed.has(node.id);
  return (
    <li>
      <div className="octree-node">
        <TileCard
          tile={liveTile(node)}
          editable={canEditTile(node)}
          editing={editingId === node.id}
          onEdit={() => setEditingId(node.id)}
          onCancel={() => setEditingId(null)}
          onSaved={onSaved}
          serviceTags={serviceTags}
          profileBase={profileBase}
          footer={
            kids.length ? (
              <button
                type="button"
                onClick={() => toggle(node.id)}
                aria-expanded={!isCollapsed}
                className="mt-1 inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-brand-700 hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
            <TreeNode
              key={k.id}
              node={k}
              collapsed={collapsed}
              toggle={toggle}
              liveTile={liveTile}
              canEditTile={canEditTile}
              editingId={editingId}
              setEditingId={setEditingId}
              onSaved={onSaved}
              serviceTags={serviceTags}
              profileBase={profileBase}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ---- A single square employee tile ----------------------------------------
function TileCard({
  tile,
  editable,
  editing,
  onEdit,
  onCancel,
  onSaved,
  serviceTags,
  profileBase,
  footer,
}: {
  tile: OrgTile;
  editable: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (t: OrgTile) => void;
  serviceTags: Tag[];
  profileBase: string | null;
  footer?: ReactNode;
}) {
  const profileHref = profileBase ? `${profileBase}/${tile.id}` : null;
  const latest = tile.latestNotes[0];
  const sched = tile.serviceSchedulingNote || tile.personalSchedulingNote;

  return (
    <div className="oct-tile">
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
        </div>
        <div className="oct-sub">{[tile.title || tile.role, tile.branchLabel].filter(Boolean).join(" · ") || "—"}</div>
      </div>

      {/* Certifications */}
      {tile.certifications.length ? (
        <div className="mt-2">
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
        <div className="mt-2">
          <div className="oct-label">Approved to do</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {tile.approvedServices.map((s) => (
              <span key={s.key} className="oct-chip">{s.label}</span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Service notes */}
      {tile.serviceNotes ? (
        <p className="mt-2 text-[11px] leading-snug text-muted">{tile.serviceNotes}</p>
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

      {/* Edit affordance (authorized only, read-only tiles show nothing) */}
      {editable && !editing ? (
        <button
          type="button"
          onClick={onEdit}
          className="mt-2 inline-flex items-center gap-1 self-start rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Icon path={ICON.edit} className="h-3 w-3" /> Edit details
        </button>
      ) : null}

      {editing ? (
        <TileEditor tile={tile} serviceTags={serviceTags} onCancel={onCancel} onSaved={onSaved} />
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

// Pure-CSS VERTICAL indented connector tree + the square tile styling. The tree
// flows top-down (manager on top, reports beneath, indented one step) so it
// reads like an outline and never sprawls sideways — no left/right sliding.
// Namespaced `oct`/`octree` so it never collides with the legacy
// OrgChartClient's `.orgtree`.
const CSS = `
.octree { display: block; width: 100%; }
.octree ul { list-style: none; margin: 0; padding: 0; }
.octree li { position: relative; list-style: none; }

/* A root stacks vertically with a little breathing room between branches. */
.octree > ul > li { margin-bottom: 18px; }

/* Nested reports: indent one step under the manager and draw the rail + elbow
   on each child so siblings share one continuous vertical line. */
.octree ul ul { margin: 0 0 0 20px; }
.octree ul ul > li { padding-left: 26px; }
.octree ul ul > li::before { content: ''; position: absolute; left: 0; top: 0; width: 2px; height: 100%; background: #C3DAC9; }
.octree ul ul > li:last-child::before { height: 30px; }
.octree ul ul > li::after { content: ''; position: absolute; left: 0; top: 30px; width: 22px; height: 2px; background: #C3DAC9; }

.octree-node { padding: 8px 0; }

@media (max-width: 640px) {
  .octree ul ul { margin-left: 10px; }
  .octree ul ul > li { padding-left: 18px; }
  .octree ul ul > li::after { width: 14px; }
}

.oct-tile {
  display: flex; flex-direction: column; width: 240px; max-width: 86vw;
  border: 1px solid #D9DEDA; border-radius: 12px; background: linear-gradient(160deg,#FFFFFF,#F4F6F5);
  padding: 12px; text-align: left;
  box-shadow: 0 1px 2px rgba(8,37,24,.04), 0 14px 30px -24px rgba(8,37,24,.45);
}
.oct-name { font-size: 14px; font-weight: 500; color: #0B3D20; line-height: 1.2; }
.oct-sub { font-size: 11px; color: #5C6B62; line-height: 1.3; margin-top: 2px; }
.oct-label { font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #5C6B62; }
.oct-route { display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; border-radius: 999px; background: #1F5836; color: #EEF4F0; font-size: 10px; font-weight: 600; padding: 2px 7px; white-space: nowrap; }
.oct-chip { display: inline-flex; align-items: center; gap: 3px; border-radius: 999px; background: #EEF4F0; color: #1F5836; font-size: 10px; font-weight: 500; padding: 2px 7px; }
.oct-chip-cert { background: #DCE9DF; color: #144229; }
.oct-sched { margin-top: 8px; border-left: 3px solid #E3B23C; background: #FFFBEB; border-radius: 0 8px 8px 0; padding: 6px 8px; font-size: 11px; line-height: 1.35; color: #7a5a12; }
.oct-sched-label { display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #8F6400; margin-right: 4px; }
.oct-note { margin-top: 8px; border-top: 1px dashed #D9DEDA; padding-top: 6px; display: flex; flex-direction: column; }
.oct-editor { margin-top: 8px; border-top: 1px dashed #D9DEDA; padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.oct-field { display: flex; flex-direction: column; gap: 2px; }
.oct-input { width: 100%; border: 1px solid #D9DEDA; border-radius: 8px; background: #fff; padding: 5px 8px; font-size: 12px; color: #1D2A23; }
.oct-input:focus-visible { outline: none; border-color: #4F8A5F; box-shadow: 0 0 0 2px rgba(79,138,95,.35); }
@media (max-width: 640px) { .oct-tile { width: 260px; } }
`;
