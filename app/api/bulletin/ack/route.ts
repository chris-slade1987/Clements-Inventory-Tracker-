import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;

// Record that the signed-in user has read/acknowledged a post. Any logged-in
// user may acknowledge; idempotent (one row per user per post).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const postId = typeof body?.postId === "string" ? body.postId : "";
  if (!postId) return NextResponse.json({ error: "Missing post." }, { status: 400 });

  const post = await prisma.bulletinPost.findUnique({ where: { id: postId }, select: { id: true, published: true } });
  if (!post || !post.published) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.bulletinAck.upsert({
    where: { postId_userId: { postId, userId: user.id } },
    create: { postId, userId: user.id, userName: user.name, branch: user.branch },
    update: {},
  });
  return NextResponse.json({ ok: true });
}
