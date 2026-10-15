import "server-only";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_GRANTS, LEVELS, sanitizeGrants, hasAccess, hasEdit,
  type Grants,
} from "@/lib/access-catalog";
import {
  isSuperAdmin, isBoardObserver, isFieldOpsDirector, isServiceAdvisor,
  type SessionUser,
} from "@/lib/auth";

// Persistence lives in the key/value `Setting` table, so there is no schema
// migration: when a super admin edits a level's defaults or a single person's
// rights, we store ONLY the diff from code's DEFAULT_GRANTS. Nothing stored =
// the catalog default, so the product keeps working before anyone edits.
const LEVELS_KEY = "access_level_grants"; // { [levelKey]: Grants }
const OVERRIDES_KEY = "access_user_overrides"; // { [userId]: Grants }

/**
 * Who may open and edit the Access Rights screen. The user asked for this to be
 * the super admins — Chris, Julie, April. In code today that is the true super
 * admin (Chris) plus the senior-leadership (Julie) and HR (April) flag holders.
 * Gating on the flags keeps it working if those people change.
 */
export function canManageAccessRights(user: SessionUser): boolean {
  return isSuperAdmin(user) || user.seniorLeadership || user.hrAccess;
}

/** Map a user to one access level key (see lib/access-catalog LEVELS). */
export function deriveLevelKey(user: Pick<SessionUser, "role" | "accessLevel" | "seniorLeadership" | "hrAccess" | "boardObserver" | "branch" | "email">): string {
  if (isBoardObserver(user as SessionUser)) return "board";
  if (isFieldOpsDirector(user)) return "field_ops";
  if (user.role === "admin") return isSuperAdmin(user) ? "super_admin" : "admin";
  if (user.accessLevel === "sales_director") return "sales_director";
  if (user.hrAccess) return "hr";
  if (user.seniorLeadership) return "senior";
  if (isServiceAdvisor(user)) return "service_advisor";
  if (user.role === "manager") return "manager";
  return "employee";
}

async function readJson(key: string): Promise<Record<string, unknown>> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function writeJson(key: string, value: Record<string, unknown>): Promise<void> {
  const str = JSON.stringify(value);
  await prisma.setting.upsert({ where: { key }, create: { key, value: str }, update: { value: str } });
}

/** All level grants: code defaults overlaid with any saved per-level edits. */
export async function getLevelGrants(): Promise<Record<string, Grants>> {
  const saved = await readJson(LEVELS_KEY);
  const out: Record<string, Grants> = {};
  for (const lvl of LEVELS) {
    out[lvl.key] = lvl.key in saved ? sanitizeGrants(saved[lvl.key]) : { ...DEFAULT_GRANTS[lvl.key] };
  }
  return out;
}

/** Per-user override maps (only users who have a customization). */
export async function getUserOverrides(): Promise<Record<string, Grants>> {
  const saved = await readJson(OVERRIDES_KEY);
  const out: Record<string, Grants> = {};
  for (const [uid, g] of Object.entries(saved)) out[uid] = sanitizeGrants(g);
  return out;
}

/** Save a level's default grants (super admin only — enforced at the route). */
export async function saveLevelGrants(levelKey: string, grants: Grants): Promise<void> {
  if (!LEVELS.some((l) => l.key === levelKey)) throw new Error("unknown level");
  const saved = await readJson(LEVELS_KEY);
  saved[levelKey] = sanitizeGrants(grants);
  await writeJson(LEVELS_KEY, saved);
}

/** Save one user's override map; an empty map clears their customization. */
export async function saveUserOverride(userId: string, grants: Grants): Promise<void> {
  const saved = await readJson(OVERRIDES_KEY);
  const clean = sanitizeGrants(grants);
  if (Object.keys(clean).length === 0) delete saved[userId];
  else saved[userId] = clean;
  await writeJson(OVERRIDES_KEY, saved);
}

/** The grants a specific user effectively has: their level's defaults, then overrides. */
export async function effectiveGrantsForUser(user: SessionUser): Promise<Grants> {
  const [levels, overrides] = await Promise.all([getLevelGrants(), getUserOverrides()]);
  const base = levels[deriveLevelKey(user)] ?? {};
  return { ...base, ...(overrides[user.id] ?? {}) };
}

/**
 * Convenience resolvers for page/route guards. NOTE: these are available for the
 * portal to adopt page-by-page; the existing per-page guards remain in place as
 * the safety net until enforcement is wired in deliberately (so no one is locked
 * out by a defaults mismatch). See CLAUDE.md.
 */
export async function userCanAccess(user: SessionUser, itemId: string): Promise<boolean> {
  return hasAccess(await effectiveGrantsForUser(user), itemId);
}
export async function userCanEdit(user: SessionUser, itemId: string): Promise<boolean> {
  return hasEdit(await effectiveGrantsForUser(user), itemId);
}

/** Active users for the Individual Users picker. */
export async function listManageableUsers(): Promise<{ id: string; name: string; email: string; level: string; branch: string | null }[]> {
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, role: true, accessLevel: true, seniorLeadership: true, hrAccess: true, boardObserver: true, branch: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    branch: u.branch,
    level: deriveLevelKey(u as unknown as SessionUser),
  }));
}
