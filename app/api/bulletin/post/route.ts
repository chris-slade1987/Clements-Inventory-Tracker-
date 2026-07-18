import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canPostBulletin } from "@/lib/bulletin";
import { saveUpload, deleteUpload } from "@/lib/storage";

export const runtime = "nodejs";

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const dateOf = (v: unknown) => { const t = s(v); if (!t) return null; const d = new Date(t.length <= 10 ? `${t}T00:00:00Z` : t); return isNaN(d.getTime()) ? null : d; };
const TYPES = new Set(["story", "announcement", "shoutout", "event"]);

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !canPostBulletin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ct = req.headers.get("content-type") || "";

  // Multipart = create, or update (when an `id` is present), optionally with a
  // hero photo. Editing can replace the photo (new file), remove it
  // (removeImage=true), or leave it as-is.
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const g = (k: string) => s(form.get(k));
    const title = g("title");
    if (!title) return NextResponse.json({ error: "Give the post a title." }, { status: 400 });
    const type = TYPES.has(String(g("type"))) ? String(g("type")) : "story";

    // A newly uploaded photo (if any).
    let newImagePath: string | null = null, hasNewImage = false;
    const file = form.get("image");
    if (file instanceof File && file.size > 0) {
      const bytes = Buffer.from(await file.arrayBuffer());
      newImagePath = await saveUpload(bytes, file.name, file.type || "image/jpeg", "bulletin").catch(() => null);
      hasNewImage = !!newImagePath;
    }

    const common = {
      type, title, excerpt: g("excerpt"), body: g("body"), imageAlt: g("imageAlt"),
      linkUrl: g("linkUrl"), eventDate: dateOf(g("eventDate")), eventEnd: dateOf(g("eventEnd")),
      location: g("location"), honoreeName: g("honoreeName"), branch: g("branch"),
      requireAck: g("requireAck") === "true",
    };

    const id = g("id");
    if (id) {
      const existing = await prisma.bulletinPost.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
      let imagePath = existing.imagePath;
      if (hasNewImage) { if (existing.imagePath) await deleteUpload(existing.imagePath); imagePath = newImagePath; }
      else if (g("removeImage") === "true") { if (existing.imagePath) await deleteUpload(existing.imagePath); imagePath = null; }
      await prisma.bulletinPost.update({ where: { id }, data: { ...common, imagePath } });
      return NextResponse.json({ ok: true, id });
    }

    // Create. Publish mode: "now" (default), "draft", or "schedule" (with
    // publishAt). A schedule time already in the past just publishes now.
    const mode = g("publishMode") ?? "now";
    const schedAt = dateOf(g("publishAt"));
    let published = true, publishAt: Date | null = null;
    if (mode === "draft") { published = false; }
    else if (mode === "schedule" && schedAt && schedAt.getTime() > Date.now()) { published = false; publishAt = schedAt; }

    const post = await prisma.bulletinPost.create({
      data: { ...common, imagePath: newImagePath, honoreeId: g("honoreeId"), pinned: g("pinned") === "true", published, publishAt, authorId: user.id, authorName: user.name },
    });
    return NextResponse.json({ ok: true, id: post.id });
  }

  // JSON = update / delete / pin / publish toggles.
  const body = await req.json().catch(() => null);
  const action = s(body?.action);
  const id = s(body?.id);
  if (!id) return NextResponse.json({ error: "Missing post." }, { status: 400 });
  const existing = await prisma.bulletinPost.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    if (action === "delete") {
      if (existing.imagePath) await deleteUpload(existing.imagePath);
      await prisma.bulletinPost.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }
    if (action === "pin") { await prisma.bulletinPost.update({ where: { id }, data: { pinned: !existing.pinned } }); return NextResponse.json({ ok: true }); }
    // Publish a draft / scheduled post immediately (clears any scheduled time).
    if (action === "publish") { await prisma.bulletinPost.update({ where: { id }, data: { published: true, publishAt: null } }); return NextResponse.json({ ok: true }); }
    // Send a published post back to drafts.
    if (action === "unpublish") { await prisma.bulletinPost.update({ where: { id }, data: { published: false, publishAt: null } }); return NextResponse.json({ ok: true }); }
    if (action === "update") {
      await prisma.bulletinPost.update({
        where: { id },
        data: {
          type: TYPES.has(String(body?.type)) ? String(body?.type) : existing.type,
          title: s(body?.title) ?? existing.title, excerpt: s(body?.excerpt), body: s(body?.body),
          linkUrl: s(body?.linkUrl), eventDate: dateOf(body?.eventDate), eventEnd: dateOf(body?.eventEnd),
          location: s(body?.location), honoreeName: s(body?.honoreeName), branch: s(body?.branch),
        },
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
