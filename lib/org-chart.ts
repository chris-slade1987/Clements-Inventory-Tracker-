import "server-only";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import { branchLabel } from "@/lib/management";
import {
  parseApprovedServices,
  sanitizeServiceTags,
  serializeApprovedServices,
  isServiceTag,
} from "@/lib/service-catalog";
import { routeNumberFor } from "@/lib/route-numbers";
import { isBoardObserver, type SessionUser } from "@/lib/auth";

// Org Chart (Round 1) — data + services layer for the real reporting org chart of
// rich employee tiles. Builds on the existing reporting structure (Employee.reportsToId /
// the "OrgChart" self-relation in lib/org.ts) and adds the tile payload: operational
// fields, earned internal certifications (from the Training Center cert program),
// approved services, scheduling notes, route number, and the latest employee notes.
//
// COMPANY-READABLE: the directory/chart structure + these operational fields are
// visible to all authenticated users. Sensitive personnel data (pay, discipline,
// PTO, birth year, …) is deliberately NOT selected here.

export type OrgTileCert = { code: string; name: string; awardedAt: string };
export type OrgTileNote = { id: string; authorId: string | null; authorName: string; body: string; createdAt: string };

export type OrgTile = {
  id: string;
  name: string;
  title: string | null;
  role: string | null;
  branch: string | null; // branch key ("vero" | "stuart" | "orlando" | "naples")
  branchLabel: string | null; // human label
  reportsToId: string | null; // for the tree
  routeNumber: string | null;
  certifications: OrgTileCert[]; // earned internal certs (CertAward)
  approvedServices: { key: string; label: string }[];
  serviceNotes: string | null;
  serviceSchedulingNote: string | null;
  personalSchedulingNote: string | null;
  // Corporate role / "who to go to" reference (Round 4).
  roleResponsibilities: string | null; // what they do (one bullet per line)
  contactReasons: string | null; // when to go to them (one bullet per line)
  contactGuidance: string | null; // how to reach them
  latestNotes: OrgTileNote[]; // latest 1–2 employee notes for the tile
};

// How many recent notes ride along on the tile (the profile section lists all).
const TILE_NOTE_COUNT = 2;

/**
 * The per-employee tile payload for every active employee. Certs are sourced from
 * the Training Center's `CertAward` rows (an internal certification is "earned"
 * only once awarded), newest first.
 */
export async function orgTileData(): Promise<OrgTile[]> {
  const rows = await prisma.employee.findMany({
    where: { status: "active" },
    select: {
      id: true,
      name: true,
      nickname: true,
      title: true,
      role: true,
      branch: true,
      reportsToId: true,
      routeNumber: true,
      approvedServices: true,
      serviceNotes: true,
      serviceSchedulingNote: true,
      personalSchedulingNote: true,
      roleResponsibilities: true,
      contactReasons: true,
      contactGuidance: true,
      certAwards: {
        orderBy: { awardedAt: "desc" },
        select: { awardedAt: true, certification: { select: { code: true, name: true } } },
      },
      employeeNotes: {
        orderBy: { createdAt: "desc" },
        take: TILE_NOTE_COUNT,
        select: { id: true, authorId: true, authorName: true, body: true, createdAt: true },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    title: e.title,
    role: e.role,
    branch: e.branch,
    branchLabel: e.branch ? branchLabel(e.branch) : null,
    reportsToId: e.reportsToId,
    // Stored value wins (manual edits persist); otherwise resolve from the COO's
    // phone-list so the number shows + is searchable regardless of deploy-time match.
    routeNumber: e.routeNumber ?? routeNumberFor({ name: e.name, nickname: e.nickname, branch: e.branch }),
    certifications: e.certAwards.map((a) => ({
      code: a.certification.code,
      name: a.certification.name,
      awardedAt: a.awardedAt.toISOString(),
    })),
    approvedServices: parseApprovedServices(e.approvedServices),
    serviceNotes: e.serviceNotes,
    serviceSchedulingNote: e.serviceSchedulingNote,
    personalSchedulingNote: e.personalSchedulingNote,
    roleResponsibilities: e.roleResponsibilities,
    contactReasons: e.contactReasons,
    contactGuidance: e.contactGuidance,
    latestNotes: e.employeeNotes.map((n) => ({
      id: n.id,
      authorId: n.authorId,
      authorName: n.authorName,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
  }));
}

/**
 * Employee ids of the people who sit at the very TOP of the company (CEO + President
 * — Chris Slade and Tim Slade), identified by their login email then name. They
 * legitimately report to no one, so the chart never flags them "No supervisor".
 * Overridable via COMPANY_ROOT_EMAILS (comma-separated).
 */
export async function companyRootEmployeeIds(): Promise<string[]> {
  const emails = (process.env.COMPANY_ROOT_EMAILS || "c.slade@clementspestcontrol.com,tslade@clementspestcontrol.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const names = ["Chris Slade", "Christopher Slade", "Tim Slade", "Timothy Slade"];

  const ids = new Set<string>();
  const logins = await prisma.user.findMany({ where: { email: { in: emails } }, select: { employeeId: true } });
  for (const l of logins) if (l.employeeId) ids.add(l.employeeId);
  const emps = await prisma.employee.findMany({
    where: { OR: [{ email: { in: emails } }, { name: { in: names } }] },
    select: { id: true },
  });
  for (const e of emps) ids.add(e.id);
  return [...ids];
}

/**
 * Auto-heal the org chart at RUNTIME (the build-time deploy seed does not persist to
 * the live production database, so this is the only reliable write path). Idempotent
 * and cheap: always re-pins the company roots (Chris + Tim to the top), and applies
 * the Corporate Contact & Reference Sheet role details to every matching employee
 * whenever NOBODY has role details yet (the broken state) — then it's a no-op. Safe
 * to call on every super-admin org-chart load; failures are swallowed.
 */
export async function ensureOrgFixed(): Promise<void> {
  try {
    const [{ seedLeadershipRoots }, { seedCorporateRoles }] = await Promise.all([
      import("@/prisma/seed-org-chart"),
      import("@/prisma/seed-corporate-roles"),
    ]);
    await seedLeadershipRoots(prisma);
    const anyRole = await prisma.employee.count({ where: { NOT: { roleResponsibilities: null } } });
    if (anyRole === 0) await seedCorporateRoles(prisma, { force: true });
  } catch (e) {
    console.error("ensureOrgFixed failed (non-fatal):", e);
  }
}

export type OrgTreeNode = OrgTile & { reports: OrgTreeNode[] };

/**
 * The reporting tree of rich tiles. Returns the roots (top-level people with no
 * manager, or whose manager isn't in the active set) plus the flat tile list.
 * Children are sorted by name; the structure mirrors the existing chart client.
 */
export async function buildOrgTree(): Promise<{ roots: OrgTreeNode[]; tiles: OrgTile[] }> {
  const tiles = await orgTileData();
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const nodes = new Map<string, OrgTreeNode>(tiles.map((t) => [t.id, { ...t, reports: [] }]));
  const roots: OrgTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.reportsToId && byId.has(node.reportsToId) ? node.reportsToId : null;
    if (parentId) nodes.get(parentId)!.reports.push(node);
    else roots.push(node);
  }
  const byName = (a: OrgTreeNode, b: OrgTreeNode) => a.name.localeCompare(b.name);
  roots.sort(byName);
  for (const node of nodes.values()) node.reports.sort(byName);
  return { roots, tiles };
}

export type OrgSearchOpts = { branch?: string | null; service?: string | null };

/**
 * Search the org directory. Matches name, title, role, branch (key + label),
 * routeNumber, and service tags (keys + labels) — so "route 42", "bees Naples",
 * or a plain name all resolve. Every whitespace-separated token must match (AND).
 * Optional `branch` / `service` filters narrow the result set further.
 */
export function searchOrg(tiles: OrgTile[], query: string, opts: OrgSearchOpts = {}): OrgTile[] {
  const branchFilter = opts.branch?.trim() || null;
  const serviceFilter = opts.service && isServiceTag(opts.service.trim()) ? opts.service.trim() : null;

  let pool = tiles;
  if (branchFilter) pool = pool.filter((t) => t.branch === branchFilter);
  if (serviceFilter) pool = pool.filter((t) => t.approvedServices.some((s) => s.key === serviceFilter));

  const tokens = (query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return pool;

  return pool.filter((t) => {
    const parts: string[] = [
      t.name,
      t.title ?? "",
      t.role ?? "",
      t.branch ?? "",
      t.branchLabel ?? "",
      t.serviceNotes ?? "",
    ];
    if (t.routeNumber) {
      parts.push(t.routeNumber);
      // so "route 42" / "rte 42" resolve against the bare number
      parts.push(`route ${t.routeNumber}`, `rte ${t.routeNumber}`, `#${t.routeNumber}`);
    }
    for (const s of t.approvedServices) parts.push(s.key, s.label);
    const haystack = parts.join(" \u0001 ").toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  });
}

/** Convenience: load tiles and search in one call (for the API route). */
export async function searchOrgLive(query: string, opts: OrgSearchOpts = {}): Promise<OrgTile[]> {
  return searchOrg(await orgTileData(), query, opts);
}

// --- Scoped tile-field editing -------------------------------------------------

// The operational tile fields a scoped editor may change. Everything else on the
// Employee record stays owned by its existing editors (HR profile, org chart, …).
export type TileFieldPatch = {
  routeNumber?: string | null;
  approvedServices?: unknown; // array of tag keys (or JSON string); sanitized before save
  serviceNotes?: string | null;
  serviceSchedulingNote?: string | null;
  personalSchedulingNote?: string | null;
  roleResponsibilities?: string | null;
  contactReasons?: string | null;
  contactGuidance?: string | null;
};

/**
 * Who may EDIT org-chart cards (Round 4). Per the COO: EVERY staff member may add,
 * revise, or delete a card's info — EXCEPT field technicians, who are read-only.
 * Read-only board observers are also excluded. "Staff" = leadership (admins, senior
 * leadership, HR), branch managers (any branch now, not just their own), and office
 * roles (CSR, service advisors, the sales director). A technician is `role:
 * "employee"` without one of those office access levels.
 */
export function canEditOrgCards(
  user: Pick<SessionUser, "role" | "accessLevel" | "seniorLeadership" | "hrAccess" | "boardObserver">,
): boolean {
  if (isBoardObserver(user as SessionUser)) return false;
  if (user.role === "admin" || user.role === "manager") return true;
  if (user.seniorLeadership || user.hrAccess) return true;
  const OFFICE_LEVELS = new Set(["csr", "sales", "sales_director"]);
  return !!user.accessLevel && OFFICE_LEVELS.has(user.accessLevel);
}

/**
 * Server-side gate for a tile-field write. Mirrors `canEditOrgCards` (all non-tech
 * staff, company-wide). The `employeeBranch` argument is kept for the call site but
 * no longer scopes editing to a manager's own branch.
 */
export function canEditTileFields(
  user: Pick<SessionUser, "role" | "accessLevel" | "seniorLeadership" | "hrAccess" | "boardObserver">,
  _employeeBranch: string | null,
): boolean {
  return canEditOrgCards(user);
}

const MAX_SHORT = 500;
const MAX_NOTE = 2000;

function cleanStr(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Apply a scoped update to an employee's tile fields. Validates access against the
 * TARGET employee's branch, sanitizes service tags, and only touches the keys
 * present in the patch. Returns the refreshed tile. Throws HttpError on bad
 * request / access denial.
 */
export async function updateTileFields(
  user: SessionUser,
  employeeId: string,
  patch: TileFieldPatch,
): Promise<OrgTile> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, branch: true },
  });
  if (!emp) throw new HttpError("That employee no longer exists.", 404);
  if (!canEditTileFields(user, emp.branch))
    throw new HttpError("Technicians can't edit org-chart cards.", 403);

  const data: Record<string, string | null> = {};
  if ("routeNumber" in patch) data.routeNumber = cleanStr(patch.routeNumber, 50);
  if ("serviceNotes" in patch) data.serviceNotes = cleanStr(patch.serviceNotes, MAX_SHORT);
  if ("serviceSchedulingNote" in patch) data.serviceSchedulingNote = cleanStr(patch.serviceSchedulingNote, MAX_NOTE);
  if ("personalSchedulingNote" in patch) data.personalSchedulingNote = cleanStr(patch.personalSchedulingNote, MAX_NOTE);
  if ("roleResponsibilities" in patch) data.roleResponsibilities = cleanStr(patch.roleResponsibilities, MAX_NOTE);
  if ("contactReasons" in patch) data.contactReasons = cleanStr(patch.contactReasons, MAX_NOTE);
  if ("contactGuidance" in patch) data.contactGuidance = cleanStr(patch.contactGuidance, MAX_SHORT);
  if ("approvedServices" in patch) {
    const tags = sanitizeServiceTags(patch.approvedServices);
    data.approvedServices = tags.length ? serializeApprovedServices(tags) : null;
  }

  if (Object.keys(data).length === 0) throw new HttpError("Nothing to update.", 400);

  await prisma.employee.update({ where: { id: employeeId }, data });

  const tiles = await orgTileData();
  const tile = tiles.find((t) => t.id === employeeId);
  if (!tile) throw new HttpError("Employee is no longer active.", 404);
  return tile;
}
