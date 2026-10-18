import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  hasCopilotKey,
  runCopilotAgent,
  deterministicCopilotReply,
  type CopilotMessage,
  type CopilotResult,
} from "@/lib/copilot/agent";
import type { CopilotScreen } from "@/lib/copilot/system-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

// Canopy Copilot API (CanopyOS Theme 5, Wave B, plan §8). Thin handler: auth →
// parse body → run the agent → return the shared contract JSON. Sits behind the
// existing session auth like /api/insights (no access-catalog entry needed). When
// no Anthropic key is set, it uses the deterministic retrieval-only fallback so the
// panel always gets a useful, grounded-or-honest answer. Every path returns the
// exact contract shape; errors are wrapped so the panel never gets a bare 500.

function parseScreen(raw: unknown): CopilotScreen | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const path = typeof o.path === "string" ? o.path : "";
  if (!path) return undefined;
  return {
    path,
    entityType: typeof o.entityType === "string" ? o.entityType : undefined,
    entityId: typeof o.entityId === "string" ? o.entityId : undefined,
  };
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const rawMessages = Array.isArray(body?.messages) ? body.messages : null;
  if (!rawMessages || rawMessages.length === 0) {
    return NextResponse.json({ error: "No messages provided." }, { status: 400 });
  }
  const messages: CopilotMessage[] = rawMessages
    .filter((m: unknown): m is CopilotMessage => !!m && typeof m === "object" && typeof (m as CopilotMessage).content === "string" && ((m as CopilotMessage).role === "user" || (m as CopilotMessage).role === "assistant"));
  if (messages.length === 0) {
    return NextResponse.json({ error: "No valid messages provided." }, { status: 400 });
  }
  const screen = parseScreen(body?.screen);

  let result: CopilotResult;
  try {
    if (hasCopilotKey()) {
      try {
        result = await runCopilotAgent({ user, messages, screen });
      } catch (e) {
        // Model/API failure → degrade to the deterministic retrieval-only answer.
        console.error("[copilot] agent failed, using fallback:", e);
        result = await deterministicCopilotReply({ user, messages, screen });
      }
    } else {
      result = await deterministicCopilotReply({ user, messages, screen });
    }
  } catch (e) {
    // Last-resort guard: the panel must always get a usable contract response.
    console.error("[copilot] fatal, returning safe reply:", e);
    result = {
      reply: "I hit a problem answering that. Please try again, or rephrase what you need.",
      citations: [],
      actions: [],
      grounded: false,
    };
  }

  return NextResponse.json(result);
}
