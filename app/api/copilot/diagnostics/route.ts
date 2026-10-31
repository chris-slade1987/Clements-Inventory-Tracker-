import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageAccessRights } from "@/lib/access";
import { hasCopilotKey, runCopilotAgent } from "@/lib/copilot/agent";
import { aiModel } from "@/lib/ai-model";

export const runtime = "nodejs";
export const maxDuration = 60;

// Canopy Copilot — CONNECTION DIAGNOSTICS (super-admin only).
//
// Why: when the Anthropic key/model isn't resolvable at runtime (or a live call
// errors), the agent silently falls back to document-only retrieval and the panel
// says "the AI assistant isn't connected" — indistinguishable, from the outside,
// from a key that simply isn't set. This endpoint makes the real state visible
// WITHOUT ever leaking a secret: it reports which env vars are PRESENT (booleans,
// never values), the resolved model, a raw 1-token API ping, and a real agent run
// with the actual error text if it throws. Gated to Chris/Julie/April.

function mask(v: string | undefined): { present: boolean; length: number } {
  return { present: !!v, length: v ? v.length : 0 };
}

async function rawPing(model: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.INSIGHTS_ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "no key resolved from ANTHROPIC_API_KEY / INSIGHTS_ANTHROPIC_API_KEY" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 4, messages: [{ role: "user", content: "ping" }] }),
    });
    if (!res.ok) {
      // Truncate the provider's error body; it never contains the API key.
      const body = (await res.text()).slice(0, 400);
      return { ok: false, status: res.status, error: body };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message?.slice(0, 400) || "fetch failed" };
  }
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageAccessRights(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const model = aiModel.smart(); // the Copilot's tier — ping with the same model it uses
  const env = {
    hasCopilotKey: hasCopilotKey(),
    ANTHROPIC_API_KEY: mask(process.env.ANTHROPIC_API_KEY),
    INSIGHTS_ANTHROPIC_API_KEY: mask(process.env.INSIGHTS_ANTHROPIC_API_KEY),
    tiers: { cheap: aiModel.cheap(), smart: aiModel.smart() },
    overrides: {
      ANTHROPIC_MODEL_ALL: process.env.ANTHROPIC_MODEL_ALL ?? "(unset)",
      ANTHROPIC_MODEL_CHEAP: process.env.ANTHROPIC_MODEL_CHEAP ?? "(unset)",
      ANTHROPIC_MODEL_SMART: process.env.ANTHROPIC_MODEL_SMART ?? "(unset)",
      ANTHROPIC_MODEL_legacy_ignored: process.env.ANTHROPIC_MODEL ?? "(unset)",
    },
    weatherAiBrief: process.env.WEATHER_AI_BRIEF === "1",
  };

  const ping = await rawPing(model);

  // Exercise the real agent path with a representative live-data question so we
  // see exactly what the panel sees (and the real error if it throws).
  let agent: Record<string, unknown>;
  try {
    const r = await runCopilotAgent({
      user,
      messages: [{ role: "user", content: "Diagnostics: what are Vero Beach's YTD KPIs?" }],
    });
    agent = {
      ok: true,
      grounded: r.grounded,
      toolsUsed: r.toolsUsed ?? [],
      citations: r.citations.length,
      replyPreview: r.reply.slice(0, 220),
    };
  } catch (e) {
    agent = { ok: false, threw: (e as Error).message?.slice(0, 400) || "agent threw" };
  }

  return NextResponse.json({
    note: "Super-admin diagnostics. Booleans/lengths only — no secret values are returned.",
    env,
    rawApiPing: ping,
    agentRun: agent,
    interpretation:
      !env.hasCopilotKey
        ? "No API key is resolvable at runtime — the key isn't set under ANTHROPIC_API_KEY or INSIGHTS_ANTHROPIC_API_KEY for this deployment."
        : !ping.ok
          ? "Key is present but the live Anthropic call failed — see rawApiPing.status/error (401 = bad key, 404 = bad model, 429 = rate limit)."
          : (agent as { ok?: boolean }).ok === false
            ? "Raw call works but the agent loop threw — see agentRun.threw."
            : "Key + model + agent all working — if the panel still falls back, it's a client/caching issue.",
  });
}
