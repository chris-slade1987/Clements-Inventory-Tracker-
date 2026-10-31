import "server-only";

// Tiered Anthropic model selection — the cost control for all AI features.
//
// Before this, every feature hardcoded `process.env.ANTHROPIC_MODEL || "claude-opus-4-8"`,
// so everything ran on the most expensive tier (Opus 4.8, $5/$25 per MTok) — including
// bulk text summaries and the background weather briefings. This splits the fleet into:
//
//   cheap()  → Haiku 5.5  ($0.10/$0.50) — routine text: summaries, insights, KPI/sales
//              blurbs, hiring notes, weather (when AI briefs are even enabled).
//   smart()  → Sonnet 5.5 ($2/$10)      — vision + grounded reasoning: invoice/photo/doc
//              extraction and the Copilot agent, where accuracy pays for itself.
//
// Nothing defaults to Opus any more. Overrides (env): ANTHROPIC_MODEL_ALL forces every
// tier (emergency single-model switch); ANTHROPIC_MODEL_CHEAP / ANTHROPIC_MODEL_SMART
// override one tier. The legacy ANTHROPIC_MODEL var is deliberately NOT read here, so a
// stale ANTHROPIC_MODEL=claude-opus-4-8 in the environment no longer forces Opus — delete
// it (or set ANTHROPIC_MODEL_ALL) to steer the fleet.

const ALL = process.env.ANTHROPIC_MODEL_ALL;

export const aiModel = {
  cheap: (): string => ALL || process.env.ANTHROPIC_MODEL_CHEAP || "claude-haiku-5-5",
  smart: (): string => ALL || process.env.ANTHROPIC_MODEL_SMART || "claude-sonnet-5-5",
};
