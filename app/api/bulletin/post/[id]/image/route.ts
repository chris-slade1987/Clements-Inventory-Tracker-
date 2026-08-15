import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;

// Bulletin tile photo. Culture imagery isn't sensitive, but we still gate it to
// signed-in users so the storage URL stays server-side (same pattern as other
// uploads). Any logged-in user may view it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const post = await prisma.bulletinPost.findUnique({ where: { id }, select: { imagePath: true } });
  if (!post || !post.imagePath) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const headers = { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" };
  try {
    if (/^https?:\/\//.test(post.imagePath)) {
      const res = await fetch(post.imagePath);
      if (!res.ok) return NextResponse.json({ error: "Unavailable" }, { status: 502 });
      return new NextResponse(res.body, { headers: { ...headers, "content-type": res.headers.get("content-type") || "image/jpeg" } });
    }
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const bytes = await readFile(join(process.cwd(), "public", post.imagePath.replace(/^\//, "")));
    return new NextResponse(new Uint8Array(bytes), { headers });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }
}
