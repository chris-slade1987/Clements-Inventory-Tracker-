import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageAts } from "@/lib/ats";
import { hasHiringAiKey, draftHiringQuestions } from "@/lib/hiring-ai";
import type { TemplateKind } from "@/lib/hiring-templates";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

const NO_KEY_MESSAGE =
  "AI drafting needs the Anthropic key (set ANTHROPIC_API_KEY in Vercel). Meanwhile, use the off-the-shelf question bank or add a custom question.";

// AI-assist for the Hiring Template Library — HR/admin only. Drafts/refines
// best-practice, role-grounded, legally-mindful questions. Degrades gracefully:
// with NO Anthropic key it returns 200 + a clear message + empty suggestions
// (never 500), so off-the-shelf + custom keep working without a key.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canManageAts(user)) return NextResponse.json({ error: "Only HR/admin can use AI drafting." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const kind: TemplateKind = body?.kind === "screening" ? "screening" : "interview";
  const role = str(body?.role);
  const intent = str(body?.intent);
  const draft = str(body?.draft);

  if (!hasHiringAiKey()) {
    return NextResponse.json({ ok: true, available: false, suggestions: [], message: NO_KEY_MESSAGE });
  }

  try {
    const suggestions = await draftHiringQuestions({ kind, role, intent, draft });
    if (suggestions.length === 0) {
      return NextResponse.json({ ok: true, available: true, suggestions: [], message: "The assistant didn't return a usable suggestion — try adding more detail about what you want to assess." });
    }
    return NextResponse.json({ ok: true, available: true, suggestions });
  } catch (e) {
    // Never surface a 500 to the editor — report the error but keep the flow up.
    return NextResponse.json({
      ok: true,
      available: true,
      suggestions: [],
      message: `AI drafting is temporarily unavailable (${(e as Error).message}). Use the off-the-shelf bank or a custom question.`,
    });
  }
}
