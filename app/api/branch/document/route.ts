import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { saveUpload, deleteUpload } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 20;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const numOf = (v: unknown) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[$,]/g, "")); return Number.isFinite(n) ? n : null; };
const dateOf = (v: unknown) => { const t = s(v); if (!t) return null; const d = new Date(t.length <= 10 ? `${t}T00:00:00Z` : t); return isNaN(d.getTime()) ? null : d; };
const CATS = new Set(["licensing", "lease", "other"]);

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scopeOk = (branch: string | null) => !branchLocked(user) || branch === user.branch;

  const ct = req.headers.get("content-type") || "";

  // Multipart = create (optionally with a file).
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const g = (k: string) => s(form.get(k));
    const branch = branchLocked(user) ? user.branch : g("branch");
    if (!branch) return NextResponse.json({ error: "Choose a branch." }, { status: 400 });
    if (!scopeOk(branch)) return NextResponse.json({ error: "Not your branch." }, { status: 403 });
    const category = CATS.has(String(g("category"))) ? String(g("category")) : "other";
    const title = g("title");
    if (!title) return NextResponse.json({ error: "Give the document a title." }, { status: 400 });

    let filePath: string | null = null, fileName: string | null = null, mimeType: string | null = null, fileSize: number | null = null;
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      const bytes = Buffer.from(await file.arrayBuffer());
      mimeType = file.type || "application/octet-stream";
      fileName = file.name;
      fileSize = bytes.length;
      filePath = await saveUpload(bytes, file.name, mimeType, "branch-docs").catch(() => null);
    }

    const rent = numOf(g("monthlyRent"));
    const doc = await prisma.branchDocument.create({
      data: {
        branch, category, title, fileName, filePath, mimeType, fileSize,
        employeeId: g("employeeId"), holderName: g("holderName"),
        licenseType: g("licenseType"), licenseNumber: g("licenseNumber"), categories: g("categories"),
        issueDate: dateOf(g("issueDate")), expirationDate: dateOf(g("expirationDate")),
        landlord: g("landlord"), monthlyRent: rent, rentAsOf: rent != null ? new Date() : null,
        leaseStart: dateOf(g("leaseStart")), leaseEnd: dateOf(g("leaseEnd")),
        notes: g("notes"), uploadedByName: user.name,
      },
    });
    return NextResponse.json({ ok: true, id: doc.id });
  }

  // JSON = update / delete.
  const body = await req.json().catch(() => null);
  const action = s(body?.action);
  const id = s(body?.id);
  if (!id) return NextResponse.json({ error: "Missing document." }, { status: 400 });
  const existing = await prisma.branchDocument.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!scopeOk(existing.branch)) return NextResponse.json({ error: "Not your branch." }, { status: 403 });

  try {
    if (action === "delete") {
      if (existing.filePath) await deleteUpload(existing.filePath);
      await prisma.branchDocument.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }
    if (action === "update") {
      const newRent = numOf(body?.monthlyRent);
      const rentChanged = newRent != null && newRent !== existing.monthlyRent;
      await prisma.branchDocument.update({
        where: { id },
        data: {
          title: s(body?.title) ?? existing.title, category: CATS.has(String(body?.category)) ? String(body?.category) : existing.category,
          employeeId: s(body?.employeeId), holderName: s(body?.holderName),
          licenseType: s(body?.licenseType), licenseNumber: s(body?.licenseNumber), categories: s(body?.categories),
          issueDate: dateOf(body?.issueDate), expirationDate: dateOf(body?.expirationDate),
          landlord: s(body?.landlord),
          // Track rent changes so we can flag increases.
          ...(rentChanged ? { priorMonthlyRent: existing.monthlyRent, monthlyRent: newRent, rentAsOf: new Date() } : { monthlyRent: newRent ?? existing.monthlyRent }),
          leaseStart: dateOf(body?.leaseStart), leaseEnd: dateOf(body?.leaseEnd), notes: s(body?.notes),
        },
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
