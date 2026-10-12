import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { saveUpload, deleteUpload } from "@/lib/storage";
import { analyzeIntake, suggestDestination, intakeReaderMode, type IntakeAnalysis } from "@/lib/intake";
import { openingMessage } from "@/lib/intake-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

// Document Intake. Multipart POST = upload + AI read; JSON POST {action:"delete"}
// removes a pending/filed intake record and its file. Admin + manager only.
const VISION = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) return upload(req, user);

  const body = await req.json().catch(() => null);
  if (s(body?.action) === "delete") {
    const id = s(body?.id);
    if (!id) return NextResponse.json({ error: "Missing document." }, { status: 400 });
    const doc = await prisma.intakeDocument.findUnique({ where: { id } });
    if (doc?.status === "filed") return NextResponse.json({ error: "This document has already been filed." }, { status: 409 });
    await deleteUpload(doc?.filePath);
    await prisma.intakeDocument.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

async function upload(req: Request, user: { id: string; name: string }) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });

  const rawName = (file as File).name || "document";
  let mime = file.type || "application/octet-stream";
  if (!VISION.includes(mime) && /\.pdf$/i.test(rawName)) mime = "application/pdf";

  const bytes = Buffer.from(await file.arrayBuffer());
  const filePath = await saveUpload(bytes, rawName, mime, "intake");

  // Only PDFs/images can be AI-read. Other file types are stored and the user
  // tells Claude what they are in the chat.
  let analysis: IntakeAnalysis;
  let readerError: string | null = null;
  if (VISION.includes(mime)) {
    try {
      analysis = await analyzeIntake(bytes.toString("base64"), mime, rawName);
    } catch (e) {
      readerError = (e as Error).message;
      console.error("intake analyze failed, falling back:", readerError);
      analysis = { kind: "other", title: rawName.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Document", summary: "Couldn't read this one automatically — tell me what it is and where it should go.", fields: {}, source: "mock" };
    }
  } else {
    analysis = { kind: "other", title: rawName.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Document", summary: "This file type can't be auto-read — tell me what it is and where it should go.", fields: {}, source: "mock" };
  }

  try {
    const doc = await prisma.intakeDocument.create({
      data: {
        fileName: rawName, filePath, fileSize: bytes.length, mimeType: mime,
        kind: analysis.kind, title: analysis.title, aiSummary: analysis.summary,
        extracted: JSON.stringify(analysis.fields), source: analysis.source,
        status: "pending", uploadedByUserId: user.id, uploadedByName: user.name,
      },
    });
    const suggestion = await suggestDestination(analysis);
    const opening = await openingMessage(analysis);
    return NextResponse.json({
      ok: true,
      mode: readerError ? "mock" : intakeReaderMode(),
      readerError,
      doc: { id: doc.id, filePath, fileName: rawName, fileSize: bytes.length },
      analysis,
      suggestion,
      opening,
    });
  } catch (e) {
    return fail(e);
  }
}
