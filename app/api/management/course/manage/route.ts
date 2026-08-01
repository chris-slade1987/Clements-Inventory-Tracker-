import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };
const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = body?.action;

  try {
    if (action === "delete") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.course.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    if (action === "assign") {
      const courseId = str(body?.courseId);
      const employeeIds: string[] = Array.isArray(body?.employeeIds) ? body.employeeIds.filter((x: unknown) => typeof x === "string") : [];
      if (!courseId || employeeIds.length === 0)
        return NextResponse.json({ error: "Pick a course and at least one employee." }, { status: 400 });
      const dueDate = date(body?.dueDate);
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return NextResponse.json({ error: "Course not found." }, { status: 404 });

      let assigned = 0;
      let emailed = 0;
      for (const employeeId of employeeIds) {
        const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
        if (!emp) continue;
        // Skip if already assigned (don't reset progress).
        const existing = await prisma.trainingAssignment.findUnique({ where: { courseId_employeeId: { courseId, employeeId } } });
        if (existing) continue;
        const a = await prisma.trainingAssignment.create({
          data: { courseId, employeeId, branch: emp.branch, assignedById: user.id, dueDate, notifiedAt: new Date() },
        });
        assigned++;
        const res = await sendEmail({
          to: emp.email,
          subject: `New training assigned: ${course.title}`,
          kind: "training_assigned",
          relatedType: "training_assignment",
          relatedId: a.id,
          text: `Hi ${emp.name.split(" ")[0]},\n\nYou've been assigned a training course: "${course.title}".${dueDate ? ` It's due ${dueDate.toLocaleDateString()}.` : ""}\n\nComplete it here: ${base()}/me/training/${a.id}\n\nYou'll get a daily reminder until it's done.\n\n— CanopyOS`,
          html: `<p>Hi ${emp.name.split(" ")[0]},</p><p>You've been assigned a training course: <strong>${course.title}</strong>.${dueDate ? ` It's due <strong>${dueDate.toLocaleDateString()}</strong>.` : ""}</p><p><a href="${base()}/me/training/${a.id}">Complete your training →</a></p><p>You'll get a daily reminder until it's done.</p><p>— CanopyOS</p>`,
        });
        if (res.status === "sent") emailed++;
      }
      return NextResponse.json({ ok: true, assigned, emailed });
    }

    if (action === "unassign") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.trainingAssignment.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
