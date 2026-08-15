import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;

// Auth-gated download for branch documents (licenses, leases). Streams the file
// only to a signed-in manager/admin; the storage URL stays server-side.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const doc = await prisma.branchDocument.findUnique({ where: { id } });
  if (!doc || !doc.filePath) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const headers = {
    "content-type": doc.mimeType || "application/pdf",
    "content-disposition": `inline; filename="${(doc.fileName || "document").replace(/"/g, "")}"`,
    "cache-control": "private, no-store",
  };
  try {
    if (/^https?:\/\//.test(doc.filePath)) {
      const res = await fetch(doc.filePath);
      if (!res.ok) return NextResponse.json({ error: "Unavailable" }, { status: 502 });
      return new NextResponse(res.body, { headers });
    }
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const bytes = await readFile(join(process.cwd(), "public", doc.filePath.replace(/^\//, "")));
    return new NextResponse(new Uint8Array(bytes), { headers });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }
}
