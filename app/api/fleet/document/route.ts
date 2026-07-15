import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { saveUpload, deleteUpload } from "@/lib/storage";
import { analyzeDocument, matchDocVehicle, documentReaderMode, DOC_CATEGORIES } from "@/lib/documents";

export const runtime = "nodejs";
export const maxDuration = 120;

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const dateOf = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d; };
const validCat = (v: unknown) => { const c = s(v); return c && DOC_CATEGORIES.some((x) => x.key === c) ? c : "other"; };

// Document Center. `analyze` stores the upload and asks the AI where it belongs;
// `confirm` files it to a vehicle; `delete` removes it.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) return analyze(req, user);

  const body = await req.json().catch(() => null);
  const action = s(body?.action);

  if (action === "confirm") {
    const id = s(body?.id);
    if (!id) return NextResponse.json({ error: "Missing document." }, { status: 400 });
    const vehicleId = s(body?.vehicleId);
    if (!vehicleId) return NextResponse.json({ error: "Choose which vehicle this belongs to." }, { status: 400 });
    const category = validCat(body?.category);
    const expirationDate = dateOf(body?.expirationDate);
    try {
      await prisma.vehicleDocument.update({
        where: { id },
        data: {
          vehicleId,
          category,
          title: s(body?.title) ?? "Document",
          insurer: s(body?.insurer),
          policyNumber: s(body?.policyNumber),
          effectiveDate: dateOf(body?.effectiveDate),
          expirationDate,
          notes: s(body?.notes),
          remindHr: body?.remindHr !== false,
          status: "filed",
        },
      });
      // Keep the vehicle's registration-renewal field in sync for at-a-glance reminders.
      if (category === "registration" && expirationDate) {
        await prisma.vehicle.update({ where: { id: vehicleId }, data: { registrationRenewal: expirationDate } });
      }
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  if (action === "delete") {
    const id = s(body?.id);
    if (!id) return NextResponse.json({ error: "Missing document." }, { status: 400 });
    const doc = await prisma.vehicleDocument.findUnique({ where: { id } });
    await deleteUpload(doc?.filePath);
    await prisma.vehicleDocument.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

async function analyze(req: Request, user: { id: string; name: string }) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "Choose a document to upload." }, { status: 400 });
  const mime = file.type || "application/octet-stream";
  if (!ACCEPTED.includes(mime))
    return NextResponse.json({ error: "Upload a PDF or image (JPEG, PNG, WEBP)." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const rawName = (file as File).name || "document";
  const filePath = await saveUpload(bytes, rawName, mime, "vehicle-docs");

  let analysis;
  try {
    analysis = await analyzeDocument(bytes.toString("base64"), mime, rawName);
  } catch (e) {
    return NextResponse.json({ error: `Reader failed: ${(e as Error).message}` }, { status: 502 });
  }

  const vehicles = await prisma.vehicle.findMany({
    where: { status: "active" },
    select: { id: true, unitNumber: true, name: true, plate: true, vin: true, make: true, model: true, assignedTo: true, branch: true },
  });
  const match = matchDocVehicle(analysis, vehicles);

  const doc = await prisma.vehicleDocument.create({
    data: {
      vehicleId: null,
      category: analysis.category,
      title: analysis.title,
      fileName: rawName,
      filePath,
      fileSize: bytes.length,
      mimeType: mime,
      insurer: analysis.insurer,
      policyNumber: analysis.policyNumber,
      effectiveDate: analysis.effectiveDate ? new Date(analysis.effectiveDate) : null,
      expirationDate: analysis.expirationDate ? new Date(analysis.expirationDate) : null,
      aiSummary: analysis.summary,
      aiSuggestedVehicleId: match?.id ?? null,
      aiSuggestedCategory: analysis.category,
      uploadedByUserId: user.id,
      uploadedByName: user.name,
      status: "pending",
    },
  });

  const suggested = match ? vehicles.find((v) => v.id === match.id) ?? null : null;
  return NextResponse.json({
    ok: true,
    mode: documentReaderMode(),
    doc: { id: doc.id, filePath },
    analysis,
    suggestion: {
      vehicleId: match?.id ?? null,
      confidence: match?.confidence ?? null,
      vehicleLabel: suggested ? `${suggested.unitNumber ? `#${suggested.unitNumber} · ` : ""}${suggested.name}${suggested.assignedTo ? ` (${suggested.assignedTo})` : ""}` : null,
    },
  });
}
