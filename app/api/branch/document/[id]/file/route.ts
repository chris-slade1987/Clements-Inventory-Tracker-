import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { readUpload } from "@/lib/storage";

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
  const bytes = await readUpload(doc.filePath);
  if (!bytes) return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  return new NextResponse(new Uint8Array(bytes), { headers });
}
