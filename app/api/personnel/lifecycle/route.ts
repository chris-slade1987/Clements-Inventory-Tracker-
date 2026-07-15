import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";
import { type SeparationDoc } from "@/lib/separation";

export const runtime = "nodejs";
export const maxDuration = 60;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const bool = (v: unknown) => v === true || v === "true" || v === "on" || v === "yes";
const dateOf = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d; };

// Employee lifecycle for HR: add a profile, terminate (with reason, supporting
// docs & exit-interview handling), record/bypass the exit interview, and
// reactivate. All linked data is retained — termination only flips the profile
// to inactive and disables the linked login.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && !isHrDirector(user)))
    return NextResponse.json({ error: "Only HR or an admin can manage employee records." }, { status: 403 });

  const ct = req.headers.get("content-type") ?? "";
  const isForm = ct.includes("multipart/form-data");
  const form = isForm ? await req.formData().catch(() => null) : null;
  const json = isForm ? null : await req.json().catch(() => null);
  const get = (k: string): unknown => (isForm ? form?.get(k) ?? null : json?.[k]);
  const action = s(get("action"));

  try {
    // ---- add a new employee profile ----------------------------------------
    if (action === "create") {
      const name = s(get("name"));
      if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
      const emp = await prisma.employee.create({
        data: {
          name,
          email: s(get("email")),
          phone: s(get("phone")),
          role: s(get("role")),
          division: s(get("division")),
          branch: s(get("branch")),
          title: s(get("title")),
          hireDate: dateOf(get("hireDate")),
          status: "active",
        },
      });
      return NextResponse.json({ ok: true, id: emp.id });
    }

    const employeeId = s(get("employeeId"));
    if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });
    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true } });
    if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

    // ---- terminate / offboard ----------------------------------------------
    if (action === "terminate") {
      if (employee.user && employee.user.id === user.id)
        return NextResponse.json({ error: "You can't offboard your own account." }, { status: 400 });
      const separationType = s(get("separationType"));
      const lastDay = dateOf(get("lastDay")) ?? new Date();
      if (!separationType) return NextResponse.json({ error: "Choose the separation type." }, { status: 400 });

      // Store any supporting documents (multipart only).
      const docs: SeparationDoc[] = [];
      if (form) {
        const files = form.getAll("docs").filter((f): f is File => f instanceof File && f.size > 0);
        if (files.length) {
          const dir = join(process.cwd(), "public", "uploads");
          await mkdir(dir, { recursive: true }).catch(() => {});
          for (const file of files) {
            const safe = (file.name || "document").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
            const stored = `${Date.now()}-${randomBytes(4).toString("hex")}-${safe}`;
            try {
              await writeFile(join(dir, stored), Buffer.from(await file.arrayBuffer()));
              docs.push({ file: `/uploads/${stored}`, name: file.name || safe });
            } catch { /* best-effort */ }
          }
        }
      }

      const bypass = bool(get("bypassExit"));
      const data = {
        separationType,
        reasonCategory: s(get("reasonCategory")),
        reasonNotes: s(get("reasonNotes")),
        lastDay,
        rehireEligible: get("rehireEligible") == null || s(get("rehireEligible")) == null ? null : bool(get("rehireEligible")),
        docs: JSON.stringify(docs),
        exitStatus: bypass ? "bypassed" : "pending",
        exitBypassReason: bypass ? s(get("bypassReason")) : null,
        createdByUserId: user.id,
        createdByName: user.name,
      };
      await prisma.employeeSeparation.upsert({
        where: { employeeId },
        create: { employeeId, ...data },
        update: data,
      });
      await prisma.employee.update({ where: { id: employeeId }, data: { status: "inactive", terminatedAt: lastDay } });
      // Disable the linked login so a former employee can't sign in.
      if (employee.user) await prisma.user.update({ where: { id: employee.user.id }, data: { active: false } });
      return NextResponse.json({ ok: true });
    }

    // ---- record or bypass the exit interview -------------------------------
    if (action === "exit") {
      const sep = await prisma.employeeSeparation.findUnique({ where: { employeeId } });
      if (!sep) return NextResponse.json({ error: "Terminate the employee first." }, { status: 400 });
      const mode = s(get("mode")); // "complete" | "bypass"
      if (mode === "bypass") {
        await prisma.employeeSeparation.update({ where: { employeeId }, data: { exitStatus: "bypassed", exitBypassReason: s(get("bypassReason")) } });
        return NextResponse.json({ ok: true });
      }
      const responses = json?.responses && typeof json.responses === "object" ? JSON.stringify(json.responses) : sep.exitResponses;
      await prisma.employeeSeparation.update({
        where: { employeeId },
        data: { exitResponses: responses, exitStatus: "completed", exitInterviewAt: new Date(), exitInterviewBy: user.name },
      });
      return NextResponse.json({ ok: true });
    }

    // ---- reactivate (rehire / correction) ----------------------------------
    if (action === "reactivate") {
      await prisma.employeeSeparation.deleteMany({ where: { employeeId } });
      await prisma.employee.update({ where: { id: employeeId }, data: { status: "active", terminatedAt: null } });
      if (employee.user) await prisma.user.update({ where: { id: employee.user.id }, data: { active: true } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    const msg = (e as { code?: string }).code === "P2002" ? "That email is already on another profile." : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
