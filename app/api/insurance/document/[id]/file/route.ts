import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;

// Auth-gated download for insurance documents. These contain sensitive data
// (EINs, premiums), so the file is streamed only to a signed-in manager/admin —
// the underlying storage URL is never exposed to the browser.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const doc = await prisma.insuranceDocument.findUnique({ where: { id } });
  if (!doc || !doc.filePath) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const headers = {
    "content-type": doc.mimeType || "application/pdf",
    "content-disposition": `inline; filename="${(doc.fileName || "document.pdf").replace(/"/g, "")}"`,
    "cache-control": "private, no-store",
  };

  try {
    if (/^https?:\/\//.test(doc.filePath)) {
      // Durable storage (Blob) — proxy the bytes so the public URL stays server-side.
      const res = await fetch(doc.filePath);
      if (!res.ok) return NextResponse.json({ error: "Unavailable" }, { status: 502 });
      return new NextResponse(res.body, { headers });
    }
    // Local dev fallback (public/uploads).
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const bytes = await readFile(join(process.cwd(), "public", doc.filePath.replace(/^\//, "")));
    return new NextResponse(new Uint8Array(bytes), { headers });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }
}
