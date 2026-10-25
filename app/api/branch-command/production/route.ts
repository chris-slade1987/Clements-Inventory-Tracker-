import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { previewProductionReports, ingestProductionReports, type UploadFile } from "@/lib/branch-production-ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };

// Branch Command — monthly production report intake + the left-behind "gameplan".
// Managers + admins. The six PestPac exports are company-wide (all routes in one file),
// so an upload recomputes every branch's RouteMonth for the period (replace-on-reupload).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = str(body?.action);

  try {
    if (action === "preview" || action === "apply") {
      const files: UploadFile[] = Array.isArray(body?.files)
        ? body.files.filter((f: unknown): f is UploadFile => !!f && typeof (f as UploadFile).text === "string").map((f: UploadFile) => ({ fileName: String(f.fileName || "report.xls"), text: f.text }))
        : [];
      if (files.length === 0) return NextResponse.json({ error: "No files." }, { status: 400 });

      if (action === "preview") {
        return NextResponse.json(previewProductionReports(files));
      }
      const r = await ingestProductionReports({ files, uploadedById: user.id, uploadedByName: user.name ?? user.email });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "addressJob") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const job = await prisma.leftBehindJob.findUnique({ where: { id } });
      if (!job) return NextResponse.json({ error: "Not found." }, { status: 404 });
      if (branchLocked(user) && job.branch !== user.branch)
        return NextResponse.json({ error: "That is not your branch." }, { status: 403 });
      const status = str(body?.status) === "addressed" ? "addressed" : "open";
      await prisma.leftBehindJob.update({ where: { id }, data: { status, managerNote: str(body?.note) } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    console.error("POST /api/branch-command/production:", e);
    return NextResponse.json({ error: "Could not process." }, { status: 500 });
  }
}
