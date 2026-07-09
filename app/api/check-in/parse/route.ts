import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseInvoice, invoiceReaderMode } from "@/lib/invoice/parse";
import { matchProduct } from "@/lib/invoice/match";

export const runtime = "nodejs";

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  // Persist the original file locally (sandbox: public/uploads). On a
  // read-only/serverless filesystem (e.g. Vercel) this is best-effort — the
  // parse still works from the in-memory bytes, we just don't keep the file.
  // For durable production storage, upload to Supabase Storage here (see
  // DEPLOY.md) instead of the local disk.
  const rawName = (file as File).name || "invoice";
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  const stored = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeName}`;
  let filePath: string | null = null;
  try {
    const dir = join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, stored), bytes);
    filePath = `/uploads/${stored}`;
  } catch {
    filePath = null; // read-only FS — proceed without storing the file
  }

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
