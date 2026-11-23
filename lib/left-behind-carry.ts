import "server-only";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Re-loading a Branch Command month (a manager re-upload, or a revisioned seed)
// replaces its LeftBehindJob rows. Without this, every job a manager had already
// marked ADDRESSED — with their plan note — would come back "open" and re-block
// the weekly sign-off (COO 2026-11-23 weekly reload). We snapshot the addressed
// rows before the replace and re-apply status + note to the same job afterwards.
//
// Same job = same PestPac account on the same scheduled day (route and service
// text can legitimately differ between the Uncommitted Orders and schedule views).
// ---------------------------------------------------------------------------

type JobKeyable = { account: string; scheduledDate?: Date | string | null };

export function leftBehindKey(j: JobKeyable): string {
  const d = j.scheduledDate ? new Date(j.scheduledDate).toISOString().slice(0, 10) : "";
  return `${j.account.trim()}|${d}`;
}

export type AddressedCarry = Map<string, { status: string; managerNote: string | null }>;

/** Addressed jobs for a period, keyed by account + day. Call BEFORE deleting the period. */
export async function snapshotAddressed(periodKey: string): Promise<AddressedCarry> {
  const rows = await prisma.leftBehindJob
    .findMany({ where: { periodKey, status: { not: "open" } }, select: { account: true, scheduledDate: true, status: true, managerNote: true } })
    .catch(() => []);
  const m: AddressedCarry = new Map();
  for (const r of rows) m.set(leftBehindKey(r), { status: r.status, managerNote: r.managerNote });
  return m;
}

/** Re-apply carried status/notes onto freshly built rows (mutates + returns them). */
export function applyAddressed<T extends JobKeyable & { status?: string; managerNote?: string | null }>(rows: T[], carry: AddressedCarry): T[] {
  if (carry.size === 0) return rows;
  for (const r of rows) {
    const hit = carry.get(leftBehindKey(r));
    if (hit) { r.status = hit.status; r.managerNote = hit.managerNote; }
  }
  return rows;
}
