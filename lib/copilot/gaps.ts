import "server-only";
import { prisma } from "@/lib/prisma";
import { tokenize } from "@/lib/copilot/retrieve";

// ===========================================================================
// Canopy Copilot — knowledge-gaps report (CanopyOS Theme 5, Wave D, plan §10).
// ===========================================================================
//
// The self-improving loop the COO asked for: this reads the governance ledger
// (CopilotConversation / CopilotMessage / CopilotFeedback) and tells leadership
// WHAT TO WRITE NEXT. Two signals say an answer fell short:
//   1. the assistant could NOT ground the answer in company sources (grounded=false),
//   2. the user marked the answer 👎 (down).
// We roll the questions behind those signals into themes (keyword clusters) with
// counts and recent example questions, and compute a few usage-at-a-glance stats.
//
// READ-ONLY + append-only safe: this never writes. A message may carry several
// feedback rows (a changed vote is a new row, ledger discipline) — the LATEST
// row per message is the effective vote. Everything is scoped to a trailing
// window (default 90 days) so the report stays about "what's hurting us now".

export type GapReason = "ungrounded" | "thumbs_down";

export type CopilotUsageStats = {
  /** Conversations started in the window. */
  conversations: number;
  /** User questions asked (user messages). */
  questions: number;
  /** Assistant answers given. */
  answers: number;
  /** Effective 👍 / 👎 votes (latest vote per answer). */
  thumbsUp: number;
  thumbsDown: number;
  /** up / (up + down) — null when no one has voted yet. */
  thumbsUpRate: number | null;
  /** Answers grounded in company sources / answers where grounding is known. */
  groundedCount: number;
  groundedRate: number | null;
};

export type GapExample = {
  question: string;
  reason: GapReason;
  at: Date;
  screen: string | null;
};

export type KnowledgeGap = {
  /** Human label for the cluster (its top shared terms). */
  theme: string;
  /** The shared keywords that define the cluster. */
  terms: string[];
  /** Distinct gap questions in this cluster. */
  count: number;
  /** How many were ungrounded, and how many were thumbed-down (facets; may overlap). */
  ungrounded: number;
  thumbsDown: number;
  /** Most-recent, de-duplicated example questions. */
  examples: GapExample[];
};

export type CopilotInsights = {
  stats: CopilotUsageStats;
  gaps: KnowledgeGap[];
  windowDays: number;
  generatedAt: Date;
};

type LoadedMessage = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  grounded: boolean | null;
  createdAt: Date;
  feedback: { rating: string; createdAt: Date }[];
  conversation: { screen: string | null };
};

type GapItem = {
  question: string;
  reason: GapReason;
  ungrounded: boolean;
  thumbsDown: boolean;
  at: Date;
  screen: string | null;
  terms: string[];
};

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The latest effective vote on an answer ("up" | "down" | null). */
function latestVote(feedback: { rating: string; createdAt: Date }[]): "up" | "down" | null {
  let best: { rating: string; createdAt: Date } | null = null;
  for (const f of feedback) {
    if (f.rating !== "up" && f.rating !== "down") continue;
    if (!best || f.createdAt > best.createdAt) best = f;
  }
  return (best?.rating as "up" | "down") ?? null;
}

/**
 * Aggregate the Copilot governance ledger into usage stats + ranked knowledge
 * gaps. Pure read; safe to call from the super-admin page.
 */
export async function getCopilotInsights(opts: {
  windowDays?: number;
  maxGaps?: number;
  examplesPerGap?: number;
} = {}): Promise<CopilotInsights> {
  const windowDays = opts.windowDays ?? 90;
  const maxGaps = opts.maxGaps ?? 8;
  const examplesPerGap = opts.examplesPerGap ?? 3;
  const since = new Date(Date.now() - windowDays * 864e5);

  const [conversations, messages] = await Promise.all([
    prisma.copilotConversation.count({ where: { startedAt: { gte: since } } }),
    prisma.copilotMessage.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        conversationId: true,
        role: true,
        content: true,
        grounded: true,
        createdAt: true,
        feedback: { select: { rating: true, createdAt: true } },
        conversation: { select: { screen: true } },
      },
    }) as Promise<LoadedMessage[]>,
  ]);

  // ---- usage stats ----
  let questions = 0;
  let answers = 0;
  let thumbsUp = 0;
  let thumbsDown = 0;
  let groundedKnown = 0;
  let groundedCount = 0;

  // Group messages by conversation so a gap answer can find the question that
  // prompted it (messages arrive createdAt-asc).
  const byConvo = new Map<string, LoadedMessage[]>();
  for (const m of messages) {
    if (m.role === "user") questions++;
    else if (m.role === "assistant") {
      answers++;
      if (m.grounded !== null) {
        groundedKnown++;
        if (m.grounded) groundedCount++;
      }
      const vote = latestVote(m.feedback);
      if (vote === "up") thumbsUp++;
      else if (vote === "down") thumbsDown++;
    }
    const arr = byConvo.get(m.conversationId) ?? [];
    arr.push(m);
    byConvo.set(m.conversationId, arr);
  }

  const stats: CopilotUsageStats = {
    conversations,
    questions,
    answers,
    thumbsUp,
    thumbsDown,
    thumbsUpRate: thumbsUp + thumbsDown > 0 ? thumbsUp / (thumbsUp + thumbsDown) : null,
    groundedCount,
    groundedRate: groundedKnown > 0 ? groundedCount / groundedKnown : null,
  };

  // ---- collect gap items ----
  const items: GapItem[] = [];
  for (const convoMsgs of byConvo.values()) {
    for (let i = 0; i < convoMsgs.length; i++) {
      const m = convoMsgs[i];
      if (m.role !== "assistant") continue;
      const ungrounded = m.grounded === false;
      const down = latestVote(m.feedback) === "down";
      if (!ungrounded && !down) continue;

      // The question that prompted this answer: the nearest preceding user turn.
      let question = "";
      for (let j = i - 1; j >= 0; j--) {
        if (convoMsgs[j].role === "user" && convoMsgs[j].content.trim()) {
          question = convoMsgs[j].content.trim();
          break;
        }
      }
      if (!question) continue; // nothing to cluster on

      items.push({
        question,
        reason: down ? "thumbs_down" : "ungrounded",
        ungrounded,
        thumbsDown: down,
        at: m.createdAt,
        screen: m.conversation.screen,
        terms: tokenize(question),
      });
    }
  }

  // ---- cluster into themes by the most common shared term ----
  // Global document frequency across gap questions, so the theme is the term the
  // gap questions share most — i.e. the subject leadership should document.
  const globalDf = new Map<string, number>();
  for (const it of items) {
    for (const t of new Set(it.terms)) globalDf.set(t, (globalDf.get(t) ?? 0) + 1);
  }

  const clusters = new Map<string, GapItem[]>();
  for (const it of items) {
    let lead = "";
    let leadDf = -1;
    for (const t of it.terms) {
      const df = globalDf.get(t) ?? 0;
      if (df > leadDf) {
        leadDf = df;
        lead = t;
      }
    }
    const key = lead || "__other__";
    const arr = clusters.get(key) ?? [];
    arr.push(it);
    clusters.set(key, arr);
  }

  const gaps: KnowledgeGap[] = [];
  for (const [key, group] of clusters) {
    // In-cluster term frequency → the label (top 2 shared terms).
    const localDf = new Map<string, number>();
    for (const it of group) for (const t of new Set(it.terms)) localDf.set(t, (localDf.get(t) ?? 0) + 1);
    const topTerms = [...localDf.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([t]) => t);
    const theme = key === "__other__" || topTerms.length === 0 ? "Other / uncategorized" : topTerms.map(cap).join(" · ");

    // Recent, de-duplicated examples.
    const seen = new Set<string>();
    const examples: GapExample[] = [];
    for (const it of [...group].sort((a, b) => b.at.getTime() - a.at.getTime())) {
      const norm = it.question.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(norm)) continue;
      seen.add(norm);
      examples.push({ question: it.question, reason: it.reason, at: it.at, screen: it.screen });
      if (examples.length >= examplesPerGap) break;
    }

    gaps.push({
      theme,
      terms: topTerms,
      count: group.length,
      ungrounded: group.filter((g) => g.ungrounded).length,
      thumbsDown: group.filter((g) => g.thumbsDown).length,
      examples,
    });
  }

  gaps.sort((a, b) => b.count - a.count || b.ungrounded + b.thumbsDown - (a.ungrounded + a.thumbsDown));

  return {
    stats,
    gaps: gaps.slice(0, maxGaps),
    windowDays,
    generatedAt: new Date(),
  };
}
