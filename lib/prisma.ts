import { PrismaClient } from "@prisma/client";

/**
 * Harden a Postgres connection string so serverless runtime queries can't hang
 * (the #1 cause of runaway Vercel "Function Duration" bills on this app):
 *
 *  - `pgbouncer=true` — REQUIRED when DATABASE_URL points at a Neon/pgBouncer
 *    POOLED endpoint (host contains `-pooler`). Without it, Prisma issues
 *    prepared statements that collide on a transaction-mode pooler and queries
 *    HANG to the function's max duration. Harmless on a direct endpoint (it just
 *    disables prepared statements), so we set it unconditionally for safety.
 *  - `connect_timeout=10` / `pool_timeout=10` — a bad connection or an exhausted
 *    pool now ERRORS in ~10s instead of hanging for minutes.
 *
 * Returns undefined for SQLite / non-Postgres URLs (local sandbox) so the client
 * falls back to the schema's `env("DATABASE_URL")` untouched.
 */
function hardenedDbUrl(raw: string | undefined): string | undefined {
  if (!raw || !/^postgres(ql)?:\/\//i.test(raw)) return undefined;
  try {
    const u = new URL(raw);
    if (!u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true");
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "10");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "10");
    return u.toString();
  } catch {
    return raw;
  }
}

const datasourceUrl = hardenedDbUrl(process.env.DATABASE_URL);

// Reuse a single PrismaClient across hot-reloads in dev to avoid exhausting
// database connections. In production the module-level const is itself the
// singleton (one client per serverless instance).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
