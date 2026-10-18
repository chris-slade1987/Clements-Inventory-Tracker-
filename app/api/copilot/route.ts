import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, type SessionUser } from "@/lib/auth";
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

// --- Governance logging (Wave D, plan §10). Persist each turn to the append-only
// Copilot ledger: create-or-continue a conversation, append the user question and
// the assistant answer (with its citations, tools used, and grounded flag), and
// return the assistant messageId + conversationId so the panel can attach feedback.
// BEST-EFFORT: the whole thing is wrapped in try/catch by the caller, so a logging
// failure (DB down, etc.) never breaks the reply. We store ONLY what already flowed
// through the user's own scoped answer — never anything the user couldn't see.
async function logTurn(
  user: SessionUser,
  messages: CopilotMessage[],
  screen: CopilotScreen | undefined,
  conversationId: string | undefined,
  result: CopilotResult,
): Promise<{ conversationId: string; messageId: string }> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content?.trim() ?? "";

  // Continue an existing conversation if the panel sent a valid id; otherwise open one.
  let convoId = "";
  if (conversationId) {
    const existing = await prisma.copilotConversation.findUnique({ where: { id: conversationId }, select: { id: true } });
    if (existing) convoId = existing.id;
  }
  if (!convoId) {
    const convo = await prisma.copilotConversation.create({
      data: {
        userId: user.id,
        userName: user.name,
        role: user.role,
        branch: user.branch,
        screen: screen?.path ?? null,
      },
      select: { id: true },
    });
    convoId = convo.id;
  }

  if (lastUser) {
    await prisma.copilotMessage.create({ data: { conversationId: convoId, role: "user", content: lastUser } });
  }
  const assistant = await prisma.copilotMessage.create({
    data: {
      conversationId: convoId,
      role: "assistant",
      content: result.reply,
      sourcesJson: result.citations.length ? JSON.stringify(result.citations) : null,
      toolsJson: result.toolsUsed && result.toolsUsed.length ? JSON.stringify(result.toolsUsed) : null,
      grounded: result.grounded,
    },
    select: { id: true },
  });
  return { conversationId: convoId, messageId: assistant.id };
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
  // Optional (additive): the panel MAY echo a conversationId to continue a thread.
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;

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

  // Governance logging — best-effort. A failure here must NEVER break the reply, so
  // it's fully isolated; on success we return the ids as ADDITIVE response fields
  // (Wave C ignores unknown fields, so this stays backward-compatible). toolsUsed is
  // logged to the ledger but deliberately NOT surfaced in the response contract.
  let ids: { conversationId?: string; messageId?: string } = {};
  try {
    ids = await logTurn(user, messages, screen, conversationId, result);
  } catch (e) {
    console.error("[copilot] turn logging failed (non-fatal):", e);
  }

  return NextResponse.json({
    reply: result.reply,
    citations: result.citations,
    actions: result.actions,
    grounded: result.grounded,
    ...(ids.conversationId ? { conversationId: ids.conversationId } : {}),
    ...(ids.messageId ? { messageId: ids.messageId } : {}),
  });
}
