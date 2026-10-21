import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;

// Auth-gated download for database-stored uploads (lib/storage.ts DB tier).
// Any signed-in user may fetch; the bytes never leave the server as a public
// URL. Documents are referenced as /api/file/<id> on their records.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const file = await prisma.storedFile.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "content-type": file.contentType || "application/octet-stream",
      "content-disposition": `inline; filename="${(file.name || "document").replace(/"/g, "")}"`,
      "content-length": String(file.size),
      "cache-control": "private, no-store",
    },
  });
}
