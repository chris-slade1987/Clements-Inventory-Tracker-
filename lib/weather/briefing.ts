import "server-only";
import type { BriefingContent, DayPoint, Flag, HourPoint, RiskLevel, WxAlert } from "./types";
import { localDate, localHour } from "./rules";

// Weather Ops — the AI ops briefing. Reuses the app's Anthropic calling pattern
// (raw fetch to /v1/messages, ANTHROPIC_API_KEY, ANTHROPIC_MODEL || claude-opus-4-8,
// "return ONLY JSON" + defensive extract). The deterministic rules engine has ALREADY
// computed the flags + risk; the model only EXPLAINS them and must never contradict
// them. If the key is missing or the call fails, we return a deterministic fallback so
// the page always renders. See docs/WEATHER-OPS.md.

export function hasWeatherAiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM_PROMPT = `You are the operations advisor for a Florida pest-control branch manager. You turn a weather forecast into a short, concrete ops read: what to do, and when.

Rules:
- Write for a pest control branch manager in Florida. Be direct and plain-spoken. Give specific hours (e.g. "before 1pm", "after 2pm").
- Recommend actions. Do not just restate raw numbers already shown on screen (temps, wind mph, rain %).
- The RISK LEVEL and FLAGS are already computed and are authoritative. NEVER contradict them or invent a different risk level.
- Service lines: "lawn" (liquid + granular lawn/ornamental apps — wash-off and drift sensitive), "pest" (general pest / perimeter), "termite" (WDO / tent / soil treatments).
- Respond with ONLY a JSON object (no prose, no code fences) in EXACTLY this shape:
{
  "headline": "one punchy line, e.g. 'Storms likely after 2pm — front-load lawn routes'",
  "summary": "2-4 sentence plain-language ops read for the manager",
  "bestWorkWindow": "e.g. '7am-1pm'",
  "byServiceLine": { "lawn": "...", "pest": "...", "termite": "..." },
  "crewSafety": "heat/lightning/wind safety actions, or 'No special precautions today.'",
  "lookAhead": "one line on the next 4 days that matters for scheduling"
}`;

function fmtHours(hours: HourPoint[]): string {
  return hours
    .map((h) => {
      const hh = localHour(h.time);
      const ampm = hh === 0 ? "12am" : hh < 12 ? `${hh}am` : hh === 12 ? "12pm" : `${hh - 12}pm`;
      const bits = [`${ampm}`, h.tempF != null ? `${h.tempF}°F` : null, `${h.pop}% rain`, h.windMph != null ? `wind ${h.windMph}mph` : null, h.short].filter(Boolean);
      return `  - ${bits.join(", ")}`;
    })
    .join("\n");
}

function buildUserPrompt(args: BriefingArgs): string {
  const { territory, date, risk, flags, hourly, daily, alerts } = args;
  const workday = hourly.filter((h) => localDate(h.time) === date && localHour(h.time) >= 7 && localHour(h.time) <= 19);
  const flagText = flags.length
    ? flags.map((f) => `  - ${f.code} (${f.level}): ${f.meaning}`).join("\n")
    : "  - none";
  const dailyText = daily.slice(0, 10).map((d) => `  - ${d.name}: ${d.short}${d.tempF != null ? `, ${d.tempF}°F` : ""}${d.pop != null ? `, ${d.pop}% rain` : ""}`).join("\n");
  const alertText = alerts.length ? alerts.map((a) => `  - ${a.event} (${a.severity}): ${a.headline}`).join("\n") : "  - none";
  return [
    `TERRITORY: ${territory}`,
    `DATE: ${date}`,
    `COMPUTED RISK LEVEL (authoritative): ${risk.toUpperCase()}`,
    ``,
    `COMPUTED FLAGS (authoritative):`,
    flagText,
    ``,
    `TODAY'S HOURLY (7am-7pm workday):`,
    workday.length ? fmtHours(workday) : "  - (no hourly data)",
    ``,
    `5-DAY OUTLOOK:`,
    dailyText || "  - (no data)",
    ``,
    `ACTIVE ALERTS:`,
    alertText,
    ``,
    `Write the ops briefing JSON now. Respect the risk level and flags exactly.`,
  ].join("\n");
}

export type BriefingArgs = {
  territory: string;
  date: string;
  risk: RiskLevel;
  flags: Flag[];
  hourly: HourPoint[];
  daily: DayPoint[];
  alerts: WxAlert[];
};

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in briefing response");
  return JSON.parse(candidate.slice(start, end + 1));
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function normalize(raw: Record<string, unknown>): BriefingContent {
  const bsl = (raw.byServiceLine ?? {}) as Record<string, unknown>;
  return {
    headline: str(raw.headline, "Forecast ready"),
    summary: str(raw.summary),
    bestWorkWindow: str(raw.bestWorkWindow),
    byServiceLine: {
      lawn: str(bsl.lawn),
      pest: str(bsl.pest),
      termite: str(bsl.termite),
    },
    crewSafety: str(raw.crewSafety),
    lookAhead: str(raw.lookAhead),
  };
}

/** Deterministic briefing used when AI is unconfigured or fails — flags as bullets. */
export function fallbackBriefing(args: BriefingArgs): BriefingContent {
  const { risk, flags } = args;
  const active = flags.filter((f) => f.code !== "FERT_BLACKOUT");
  const headline =
    risk === "red" ? "Red day — expect disruption" : risk === "yellow" ? "Caution — weather affects some work" : "Clear to work";
  const summary = active.length
    ? `Computed flags: ${active.map((f) => f.label).join("; ")}. ${active.map((f) => f.meaning).join(" ")}`
    : "No weather flags today. Normal scheduling.";
  const thunder = flags.find((f) => f.code === "THUNDER");
  return {
    headline,
    summary,
    bestWorkWindow: thunder ? "Front-load the morning" : "Normal hours",
    byServiceLine: {
      lawn: flags.some((f) => ["RAIN_WINDOW", "HEAVY_RAIN", "WIND_NO_SPRAY", "WIND_CAUTION"].includes(f.code))
        ? "Favor granular over liquid; schedule liquids outside the rain/wind window."
        : "No weather constraint on lawn apps.",
      pest: flags.some((f) => f.code === "THUNDER" || f.code === "NWS_WARNING" || f.code === "TROPICAL")
        ? "Hold outdoor perimeter work during storm hours."
        : "No weather constraint on pest service.",
      termite: risk === "red" ? "Reschedule tent/soil work if storms or tropical impacts land." : "No weather constraint on termite work.",
    },
    crewSafety: flags.some((f) => f.code === "HEAT_EXTREME")
      ? "Extreme heat — adjust crew schedule, mandatory breaks and water."
      : flags.some((f) => f.code === "HEAT_HIGH")
        ? "High heat — mandatory breaks and water."
        : thunder
          ? "Stop outdoor work during thunderstorms."
          : "No special precautions today.",
    lookAhead: "See the 5-day outlook for scheduling the rest of the week.",
  };
}

/** Generate the AI briefing; falls back deterministically on any failure. */
export async function generateBriefing(args: BriefingArgs): Promise<{ content: BriefingContent; model: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { content: fallbackBriefing(args), model: "fallback" };
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(args) }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
    return { content: normalize(extractJson(text)), model };
  } catch (e) {
    console.error("weather briefing (non-fatal, using fallback):", e);
    return { content: fallbackBriefing(args), model: "fallback" };
  }
}
