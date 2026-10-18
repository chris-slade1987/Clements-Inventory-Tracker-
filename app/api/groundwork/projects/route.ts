import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { fail } from "@/lib/http";
import {
  createProject, updateProject, listProjects, getProject,
  addProjectMember, removeProjectMember,
} from "@/lib/groundwork";

export const runtime = "nodejs";
export const maxDuration = 20;

// Groundwork Projects surface. Reads (GET): the user's projects, or one project
// with its members + To-Dos. Writes (POST, action switch): create / update /
// add-member ("send to people" — notifies) / remove-member. Access scoping in
// lib/groundwork.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      const data = await getProject(user, id);
      if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return NextResponse.json(data);
    }
    const projects = await listProjects(user);
    return NextResponse.json({ projects });
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
        const project = await createProject(user, body);
        return NextResponse.json({ ok: true, project });
      }
      case "update": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const project = await updateProject(user, String(body.id), body);
        return NextResponse.json({ ok: true, project });
      }
      case "add_member": {
        if (!body.projectId || !body.userId) return NextResponse.json({ error: "Missing project or user." }, { status: 400 });
        const role = ["owner", "member", "viewer"].includes(body.role) ? body.role : "member";
        await addProjectMember(user, String(body.projectId), String(body.userId), role);
        return NextResponse.json({ ok: true });
      }
      case "remove_member": {
        if (!body.projectId || !body.userId) return NextResponse.json({ error: "Missing project or user." }, { status: 400 });
        await removeProjectMember(user, String(body.projectId), String(body.userId));
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
