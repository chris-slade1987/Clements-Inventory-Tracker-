import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import { recordTypeLabel, notifyList } from "@/lib/personnel";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: FormDataEntryValue | null) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const date = (v: FormDataEntryValue | null) => { const s = typeof v === "string" ? v : ""; if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d; };
const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form." }, { status: 400 });

  const employeeId = str(form.get("employeeId"));
  const type = str(form.get("type"));
  if (!employeeId || !type) return NextResponse.json({ error: "Missing employee or type." }, { status: 400 });

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  // Branch managers may only file on their own branch's team.
  if (branchLocked(user) && employee.branch !== user.branch)
    return NextResponse.json({ error: "That employee is not on your team." }, { status: 403 });

  // Optional attachment (best-effort local storage).
  let attachmentFile: string | null = null;
  let attachmentName: string | null = null;
  const file = form.get("file");
  if (file instanceof Blob && file.size > 0) {
    attachmentName = (file as File).name || "attachment";
    const safe = attachmentName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
    const stored = `${Date.now()}-${randomBytes(4).toString("hex")}-${safe}`;
    try {
      const dir = join(process.cwd(), "public", "uploads");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, stored), Buffer.from(await file.arrayBuffer()));
      attachmentFile = `/uploads/${stored}`;
    } catch {
      attachmentFile = null;
    }
  }

  try {
    const record = await prisma.personnelRecord.create({
      data: {
        employeeId,
        branch: employee.branch,
        type,
        category: str(form.get("category")),
        title: str(form.get("title")),
        body: str(form.get("body")),
        incidentDate: date(form.get("incidentDate")),
        actionTaken: str(form.get("actionTaken")),
        followUp: str(form.get("followUp")),
        details: str(form.get("details")) ?? "{}",
        attachmentFile,
        attachmentName,
        authorId: user.id,
        authorName: user.name,
      },
    });

    // The filing supervisor's e-signature is captured automatically.
    if (type === "writeup" || type === "accident") {
      await prisma.personnelSignature.create({
        data: { recordId: record.id, role: "supervisor", signerName: user.name, statement: "Filed and certified by supervisor.", signedByUserId: user.id },
      });
    }

    // Notify HR always; add leadership (Graham, Chris, Tim) on write-ups/accidents.
    const recipients = await notifyList(type);
    const label = recordTypeLabel(type);
    const b = employee.branch ? ` (${branchLabel(employee.branch)})` : "";
    const summary = str(form.get("title")) ?? str(form.get("body"))?.slice(0, 120) ?? label;
    const res = await sendEmail({
      to: recipients,
      subject: `${label} filed: ${employee.name}${b} — by ${user.name}`,
      kind: "personnel_record",
      relatedType: "personnel_record",
      relatedId: record.id,
      text: `A ${label.toLowerCase()} was filed by ${user.name} for ${employee.name}${b}.\n\n${summary}\n\nView the employee's personnel profile: ${base()}/management/people/${employeeId}\n\n— Clements Command & Control`,
      html: `<p>A <strong>${label.toLowerCase()}</strong> was filed by ${user.name} for <strong>${employee.name}</strong>${b}.</p><p>${summary}</p><p><a href="${base()}/management/people/${employeeId}">View personnel profile →</a></p><p>— Clements Command &amp; Control</p>`,
    });
    if (res.status === "sent") await prisma.personnelRecord.update({ where: { id: record.id }, data: { hrNotified: true } });

    return NextResponse.json({ ok: true, id: record.id, notified: recipients, emailStatus: res.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
