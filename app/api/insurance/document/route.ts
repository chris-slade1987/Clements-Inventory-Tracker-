import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { saveUpload } from "@/lib/storage";
import { analyzeInsurance, insuranceReaderMode } from "@/lib/insurance";

export const runtime = "nodejs";

// Upload an insurance document (policy dec page, ACORD app, or payment schedule).
// Stores the file, has the AI read it, and returns the extracted fields for the
// manager to confirm before a policy is created. Falls back to manual entry.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Choose a document to upload." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "application/octet-stream");

  // Store the file (durable when Blob is configured, local fallback otherwise).
  const filePath = await saveUpload(bytes, file.name, mime, "insurance-docs").catch(() => null);

  // Read it — never let a reader error fail the upload.
  let analysis;
  let readerError: string | null = null;
  try {
    analysis = await analyzeInsurance(bytes.toString("base64"), mime, file.name);
  } catch (e) {
    readerError = (e as Error).message;
    const { inferLine } = await import("@/lib/insurance");
    analysis = {
      line: inferLine(file.name), name: file.name.replace(/\.[a-z0-9]+$/i, ""), carrier: null, policyNumber: null,
      agent: null, effectiveDate: null, expirationDate: null, annualPremium: null, coverages: [], paymentMethod: "direct",
      paymentFrequency: "annual", downPayment: null, numberOfPayments: null, paymentAmount: null, apr: null,
      financeCompany: null, schedule: [], summary: "Automatic reading failed — please confirm the details manually.", source: "mock" as const,
    };
  }

  const doc = await prisma.insuranceDocument
    .create({ data: { title: analysis.name || file.name, fileName: file.name, filePath, fileSize: bytes.length, mimeType: mime, category: "policy", uploadedByName: user.name } })
    .catch(() => null);

  return NextResponse.json({ ok: true, analysis, documentId: doc?.id ?? null, mode: readerError ? "mock" : insuranceReaderMode(), readerError });
}
