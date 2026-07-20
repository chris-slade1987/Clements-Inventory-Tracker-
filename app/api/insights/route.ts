import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { hasInsightsKey, runInsightsChat, type InsightsMessage } from "@/lib/insights";

export const runtime = "nodejs";
export const maxDuration = 60;

// Conversational insights assistant. Exec-sensitive financials, so gated to
// admins + senior leadership only. Degrades gracefully when no key is present.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !(user.role === "admin" || user.seniorLeadership)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Not configured yet — return a friendly 200 so the UI shows a clear state.
  if (!hasInsightsKey()) {
    return NextResponse.json({
      configured: false,
      reply:
        "The insights assistant isn't connected yet. Add an Anthropic API key (ANTHROPIC_API_KEY or INSIGHTS_ANTHROPIC_API_KEY) to enable it.",
    });
  }

  const body = await req.json().catch(() => null);
  const messages = Array.isArray(body?.messages) ? (body.messages as InsightsMessage[]) : null;
  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: "No messages provided." }, { status: 400 });
  }

  try {
    const reply = await runInsightsChat(messages);
    return NextResponse.json({ configured: true, reply });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
