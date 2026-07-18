import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ingestCoastStatement } from "@/lib/fuel";

export const runtime = "nodejs";

// Upload a Coast fuel-card statement (.xlsx). Parses, links every purchase to a
// vehicle, and stores it (idempotent). Admins & managers only.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Choose a Coast statement (.xlsx) to upload." }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json({ error: "Please upload the Coast statement as an .xlsx file." }, { status: 400 });
  }

  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const result = await ingestCoastStatement(buf);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "Could not read that statement." }, { status: 400 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
