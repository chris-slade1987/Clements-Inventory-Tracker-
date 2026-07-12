import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseMaintenance, maintReaderMode, matchVehicle } from "@/lib/fleet-invoice";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "Upload a maintenance invoice or statement." }, { status: 400 });

  const mime = file.type || "application/octet-stream";
  if (!ACCEPTED.includes(mime))
    return NextResponse.json({ error: "Upload a PDF or an image (JPEG, PNG, WEBP)." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());

  // Best-effort local persistence of the source document (read-only FS is fine).
  const rawName = (file as File).name || "maintenance";
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  const stored = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeName}`;
  let filePath: string | null = null;
  try {
    const dir = join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, stored), bytes);
    filePath = `/uploads/${stored}`;
  } catch {
    filePath = null;
  }

  let invoice;
  try {
    invoice = await parseMaintenance(bytes.toString("base64"), mime);
  } catch (e) {
    return NextResponse.json({ error: `Reader failed: ${(e as Error).message}` }, { status: 502 });
  }

  // Match each line's vehicle hint to a real vehicle so the review table can pre-fill.
  const vehicles = await prisma.vehicle.findMany({
    where: { status: "active" },
    select: { id: true, unitNumber: true, name: true, plate: true, vin: true, make: true, model: true },
  });
  const matches = invoice.lines.map((l) => matchVehicle(l.vehicleHint, vehicles));

  return NextResponse.json({ ok: true, mode: maintReaderMode(), filePath, invoice, matches });
}
