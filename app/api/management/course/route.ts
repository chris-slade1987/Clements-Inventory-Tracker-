import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: FormDataEntryValue | null) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: FormDataEntryValue | null) => { const n = parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? n : null; };

// Create / update a training course (multipart: fields + optional material file).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form." }, { status: 400 });

  const id = str(form.get("id"));
  const title = str(form.get("title"));
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  // Validate questions JSON.
  let questions: unknown = [];
  try { questions = JSON.parse(String(form.get("questions") ?? "[]")); } catch { questions = []; }
  if (!Array.isArray(questions) || questions.length === 0)
    return NextResponse.json({ error: "Add at least one quiz question." }, { status: 400 });

  // Optional uploaded material (best-effort local storage; read-only FS is fine).
  let materialFile: string | null = null;
  let materialName: string | null = null;
  const file = form.get("file");
  if (file instanceof Blob && file.size > 0) {
    const rawName = (file as File).name || "lesson";
    materialName = rawName;
    const safe = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
    const stored = `${Date.now()}-${randomBytes(4).toString("hex")}-${safe}`;
    try {
      const dir = join(process.cwd(), "public", "uploads");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, stored), Buffer.from(await file.arrayBuffer()));
      materialFile = `/uploads/${stored}`;
    } catch {
      materialFile = null;
    }
  }

  const data = {
    title,
    category: str(form.get("category")) ?? "ceu",
    description: str(form.get("description")),
    questions: JSON.stringify(questions),
    passingScore: int(form.get("passingScore")) ?? 80,
    ...(materialFile ? { materialFile, materialName } : {}),
  };

  try {
    const course = id
      ? await prisma.course.update({ where: { id }, data })
      : await prisma.course.create({ data: { ...data, createdById: user.id } });
    return NextResponse.json({ ok: true, id: course.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
