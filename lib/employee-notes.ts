import "server-only";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http";
import type { SessionUser } from "@/lib/auth";

// Org Chart (Round 1) — the attributed, timestamped EMPLOYEE NOTE log. Mirrors the
// SalesFocusComment / WorkItemComment pattern: every note stamps the author
// (id + name snapshot) and a server-set createdAt. APPEND-ONLY — notes are never
// edited or deleted in this slice; a correction is a new note so the trail stays intact.

export type EmployeeNoteDTO = {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string; // ISO
};

/**
 * Who may ADD an employee note: managers, HR, senior leadership, and (super)admins.
 * Mirrors the existing role gates (role "admin" covers super_admin + team-scoped
 * admin). Plain employees / service advisors cannot. Enforced server-side.
 */
export function canAddEmployeeNote(
  user: Pick<SessionUser, "role" | "seniorLeadership" | "hrAccess">,
): boolean {
  return (
    user.role === "admin" ||
    !!user.seniorLeadership ||
    !!user.hrAccess ||
    user.role === "manager"
  );
}

const MAX_BODY = 4000;

/**
 * Append a note to an employee's log. Stamps authorId/authorName + createdAt.
 * Throws an HttpError (handled by `fail`) on a bad request or access denial.
 */
export async function addEmployeeNote(
  user: SessionUser,
  employeeId: string,
  body: string,
): Promise<EmployeeNoteDTO> {
  if (!canAddEmployeeNote(user))
    throw new HttpError("You don't have access to add employee notes.", 403);

  const text = (body ?? "").trim().slice(0, MAX_BODY);
  if (!text) throw new HttpError("Write a note first.", 400);

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true },
  });
  if (!emp) throw new HttpError("That employee no longer exists.", 404);

  const note = await prisma.employeeNote.create({
    data: {
      employeeId,
      authorId: user.id,
      authorName: (user.name || "Someone").slice(0, 200),
      body: text,
    },
  });
  return {
    id: note.id,
    authorId: note.authorId,
    authorName: note.authorName,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
  };
}

/** List an employee's notes, newest first (author + timestamp included). */
export async function listEmployeeNotes(employeeId: string): Promise<EmployeeNoteDTO[]> {
  const rows = await prisma.employeeNote.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    authorId: r.authorId,
    authorName: r.authorName,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  }));
}
