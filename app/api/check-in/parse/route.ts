import { NextResponse } from "next/server";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { saveUpload } from "@/lib/storage";
import { parseInvoice, invoiceReaderMode } from "@/lib/invoice/parse";
import { matchProduct } from "@/lib/invoice/match";

export const runtime = "nodejs";

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Board observers have read-only access." }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Upload an invoice file." }, { status: 400 });
  }
  const mime = file.type || "application/octet-stream";
  if (!ACCEPTED.includes(mime)) {
    return NextResponse.json(
      { error: "Upload a PDF or an image (JPEG, PNG, WEBP)." },
      { status: 400 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Persist the original invoice (Vercel Blob in prod, local in dev). Best-effort:
  // the parse still works from the in-memory bytes if storage isn't available.
  const rawName = (file as File).name || "invoice";
  const filePath = await saveUpload(bytes, rawName, mime, "invoices");

  // Parse (Claude vision or mock).
  let invoice;
  try {
    invoice = await parseInvoice(bytes.toString("base64"), mime);
  } catch (e) {
    return NextResponse.json(
      { error: `Invoice reader failed: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  // Auto-match each line to a catalog product.
  const products = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, name: true, distributorSku: true },
  });
  const matches = invoice.lines.map((l) =>
    matchProduct(l.description, null, products)
  );

  return NextResponse.json({
    ok: true,
    mode: invoiceReaderMode(),
    filePath,
    invoice,
    matches,
  });
}
