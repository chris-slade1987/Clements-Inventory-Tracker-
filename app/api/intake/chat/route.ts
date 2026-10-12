import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { type IntakeAnalysis } from "@/lib/intake";
import { intakeChat, type ChatTurn } from "@/lib/intake-ai";

export const runtime = "nodejs";
export const maxDuration = 45;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };

// A follow-up turn in the intake chat. Reconstructs the stored analysis, asks
// Claude for a reply + optional routing proposal, and records the transcript.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const docId = s(body?.docId);
  const message = s(body?.message);
  if (!docId || !message) return NextResponse.json({ error: "Missing message." }, { status: 400 });

  const doc = await prisma.intakeDocument.findUnique({ where: { id: docId } });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  if (doc.status === "filed") return NextResponse.json({ error: "This document has already been filed." }, { status: 409 });

  const analysis: IntakeAnalysis = {
    kind: doc.kind, title: doc.title ?? "Document", summary: doc.aiSummary ?? "",
    fields: safeFields(doc.extracted), source: (doc.source as "claude" | "mock") ?? "mock",
  };
  const history: ChatTurn[] = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .map((m) => (m && typeof m === "object" ? m as { role?: string; content?: string } : null))
        .filter((m): m is { role: string; content: string } => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    : [];

  const result = await intakeChat(analysis, history, message);

  // Persist the transcript for the audit trail (best-effort).
  const transcript = [...history, { role: "user", content: message }, { role: "assistant", content: result.reply }];
  await prisma.intakeDocument.update({ where: { id: docId }, data: { messages: JSON.stringify(transcript).slice(0, 20000) } }).catch(() => {});

  return NextResponse.json({ ok: true, ...result });
}

function safeFields(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const o = JSON.parse(json);
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
}
