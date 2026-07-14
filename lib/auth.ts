import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "@/lib/prisma";

const COOKIE = "cinv_session";
const SESSION_DAYS = 30;

// ---- Password hashing (scrypt; no native deps) ------------------------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const testBuf = scryptSync(password, salt, 64);
  return hashBuf.length === testBuf.length && timingSafeEqual(hashBuf, testBuf);
}

// ---- Sessions ----------------------------------------------------------
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await prisma.session.create({ data: { token, userId, expiresAt } });

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  warehouseId: string | null;
  warehouseName: string | null;
  branch: string | null;
  employeeId: string | null;
};

/** A branch manager (non-admin with a home branch) only sees their own branch. */
export function branchLocked(user: SessionUser): boolean {
  return user.role !== "admin" && !!user.branch;
}

/**
 * Resolve which branch a page should show. Branch-locked managers are always
 * pinned to their own branch; admins/exec honor the requested branch (which may
 * be null = all branches).
 */
export function scopedBranch(user: SessionUser, requested: string | null): string | null {
  return branchLocked(user) ? user.branch : requested;
}

/** Where a user lands after signing in — employees to their work home,
 *  branch managers to their branch, admins to the inventory dashboard. */
export function homePath(user: SessionUser): string {
  if (user.role === "employee") return "/me";
  return branchLocked(user) ? "/my-branch" : "/dashboard";
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { warehouse: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) {
    return null;
  }

  const u = session.user;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    warehouseId: u.warehouseId,
    warehouseName: u.warehouse?.name ?? null,
    branch: u.branch,
    employeeId: u.employeeId,
  };
}

/** Use in server components / layouts to require a logged-in manager. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Require an admin. Redirects non-admins to the dashboard. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }
  jar.delete(COOKIE);
}
