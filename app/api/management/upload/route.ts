import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { claudeExtractMbr, commitMbr, normalize, type ParsedMbr } from "@/lib/mbr/extract";

export const runtime = "nodejs";
export const maxDuration = 60; // Claude document extraction; capped to bound cost.

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ct = req.headers.get("content-type") ?? "";

  // Commit step: JSON body with the reviewed parse.
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null);
    if (!body?.parsed) return NextResponse.json({ error: "Nothing to commit." }, { status: 400 });
    try {
      const result = await commitMbr(body.parsed as ParsedMbr);
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  // Parse step: multipart file upload (PDF for Claude, or a pre-structured JSON).
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "Upload an MBR PDF." }, { status: 400 });

  const name = (file as File).name ?? "";
  const mime = file.type ?? "";
  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    let parsed: ParsedMbr;
    if (name.toLowerCase().endsWith(".json") || mime.includes("json")) {
      parsed = normalize(JSON.parse(bytes.toString("utf8")), "json");
    } else if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf") || mime.startsWith("image/")) {
      if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json(
          { error: "PDF reading needs ANTHROPIC_API_KEY. Set it, or upload a structured .json extract instead." },
          { status: 400 }
        );
      }
      parsed = await claudeExtractMbr(bytes.toString("base64"), mime || "application/pdf");
    } else {
      return NextResponse.json({ error: "Upload a PDF (or a .json extract)." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, parsed });
  } catch (e) {
    return NextResponse.json({ error: `Could not read the report: ${(e as Error).message}` }, { status: 400 });
  }
}
