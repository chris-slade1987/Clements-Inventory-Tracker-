import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { fail } from "@/lib/http";
import {
  createWorkItem, updateWorkItem, completeWorkItem, cancelWorkItem, addWorkItemComment,
  getWorkItem, listMyWork,
} from "@/lib/groundwork";

export const runtime = "nodejs";
export const maxDuration = 20;

// Groundwork To-Dos surface. Reads (GET): the unified My Work queue, or one item
// with its activity log. Writes (POST, action switch): create / update / complete
// / cancel (archive — never hard-deleted) / comment. Auth via the session; access
// scoping (self vs. assign-to-others) is enforced in lib/groundwork.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const url = new URL(req.url);
    const view = url.searchParams.get("view") ?? "my-work";
    if (view === "item") {
      const id = url.searchParams.get("id") ?? "";
      const item = await getWorkItem(user, id);
      if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return NextResponse.json({ item });
    }
    const myWork = await listMyWork(user);
    return NextResponse.json({ myWork });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const action: string = typeof body.action === "string" ? body.action : "create";

  try {
    switch (action) {
      case "create": {
        const item = await createWorkItem(user, body);
        return NextResponse.json({ ok: true, item });
      }
      case "update": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const item = await updateWorkItem(user, String(body.id), body);
        return NextResponse.json({ ok: true, item });
      }
      case "complete": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const item = await completeWorkItem(user, String(body.id), body.done === false ? false : true);
        return NextResponse.json({ ok: true, item });
      }
      case "cancel": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const item = await cancelWorkItem(user, String(body.id), body.cancelled === false ? false : true);
        return NextResponse.json({ ok: true, item });
      }
      case "comment": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const comment = await addWorkItemComment(user, String(body.id), String(body.body ?? ""));
        if (!comment) return NextResponse.json({ error: "Write a comment first." }, { status: 400 });
        return NextResponse.json({ ok: true, comment });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
