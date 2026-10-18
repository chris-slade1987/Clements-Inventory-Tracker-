import { prisma } from "@/lib/prisma";
import type { KnowledgeChunk } from "@prisma/client";
import { BRANCHES } from "@/lib/management";
import { hasAccess, type Grants } from "@/lib/access-catalog";
import type { SessionUser } from "@/lib/auth";

// Canopy Copilot — retrieval & access-scoped grounding (Theme 5, Wave A, §6).
//
// `retrieve(query, { user, k })`:
//   1. resolve the user's accessTag SET from the real access model (lib/access),
//   2. fetch only non-retired chunks whose accessTag the user may see,
//   3. score by in-app keyword relevance (BM25 over the access-filtered set),
//   4. return top-k { chunk, score, citation }.
//
// PORTABILITY: scoring is pure application code over plain text, so the exact
// same path runs on SQLite (local) and Postgres (prod) — no FTS extension, no
// vector column. The `Ranker` seam below is where a future embeddings ranker
// drops in WITHOUT changing `retrieve()` or its callers.
//
// Note: the access model (lib/auth, lib/access) is imported LAZILY inside
// `accessTagsForUser` so this module stays importable from plain-Node tooling
// (the offline eval, deploy scripts) — those use the tag-scoped core + the pure
// `accessTagsFromGrants` helper and never touch the server-only auth modules.

export type Citation = { title: string; sectionTitle: string | null; href: string };
export type RetrievedChunk = { chunk: KnowledgeChunk; score: number; citation: Citation };

// A grounded answer needs a real lexical match, not one incidental word. A chunk
// qualifies only if it covers at least this fraction of the query's content
// terms (or the single term of a one-term query). This is what gives
// cite-or-decline its teeth: an out-of-scope question clears nothing and
// `retrieve()` returns [].
export const MIN_COVERAGE = 0.34;

// ---- access scoping ---------------------------------------------------------

/**
 * PURE mapping from resolved grants → the `accessTag` set a principal may see.
 * No server-only imports, so offline tooling (the eval) can reproduce exactly
 * what a logged-in user would be scoped to. Each tag maps to a concrete grant so
 * a cited source is always one the user can actually open:
 *   all        → everyone
 *   manager    → runs branch ops (My Branch / SOP / checklist grant): manual, SOPs, checklists
 *   exec       → the executive views (executive grant)
 *   internal   → the System Map tier (system-map grant): brand kit / build docs
 *   superadmin → super admins (Chris / Julie / April)
 *   branch:<k> → their branch (all-branch principals see every branch)
 */
export function accessTagsFromGrants(
  grants: Grants,
  opts: { superadmin: boolean; allBranches: boolean; branch: string | null },
): string[] {
  const tags: string[] = ["all"];
  if (hasAccess(grants, "my-branch") || hasAccess(grants, "sops") || hasAccess(grants, "checklists")) tags.push("manager");
  if (hasAccess(grants, "executive")) tags.push("exec");
  if (hasAccess(grants, "system-map")) tags.push("internal");
  if (opts.superadmin) tags.push("superadmin");
  if (opts.allBranches) tags.push(...BRANCHES.map((b) => `branch:${b.key}`));
  else if (opts.branch) tags.push(`branch:${opts.branch}`);
  return tags;
}

/**
 * The `accessTag` set this user may be served, DERIVED FROM the real access
 * grants (lib/access) — never invented. lib/auth + lib/access are imported lazily
 * (server-only) so this file stays importable from plain-Node tooling.
 */
export async function accessTagsForUser(user: SessionUser): Promise<string[]> {
  const [{ effectiveGrantsForUser, canManageAccessRights }, { isSuperAdmin, branchLocked }] = await Promise.all([
    import("@/lib/access"),
    import("@/lib/auth"),
  ]);
  const grants = await effectiveGrantsForUser(user);
  return accessTagsFromGrants(grants, {
    superadmin: isSuperAdmin(user) || canManageAccessRights(user),
    allBranches: !branchLocked(user),
    branch: user.branch,
  });
}

// ---- scoring (BM25, the swappable ranker seam) ------------------------------

const STOPWORDS = new Set(
  ("a an the of for to in on at by and or but is are be do does how what when where which who why " +
    "with from this that these those i you we they it my our your their me us them can could should would " +
    "will shall may might must as if then than so into out up down over under about please tell show give " +
    "need want get got make made use used done have has had someone").split(/\s+/),
);

/** Lowercase word tokens, punctuation stripped, stopwords + 1-char tokens dropped. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export type Scorable = { content: string; title: string; sectionTitle: string | null };
export type Scored<T> = { item: T; score: number };

/** A ranker turns a query + candidate set into scored candidates (desc). This is
 *  the seam: swap `bm25Rank` for an embeddings ranker later without touching
 *  `retrieve()`. Scores need only be comparable within one call. */
export type Ranker<T extends Scorable> = (query: string, candidates: T[]) => Scored<T>[];

const K1 = 1.5;
const B = 0.75;

/**
 * BM25 over the candidate set, with a boost when a query term also appears in the
 * chunk's title / section heading, and a coverage gate (a candidate must match
 * >= MIN_COVERAGE of the query's content terms, or the single term of a one-term
 * query). Returns only candidates that clear the gate, best first.
 */
export function bm25Rank<T extends Scorable>(query: string, candidates: T[]): Scored<T>[] {
  const qTerms = Array.from(new Set(tokenize(query)));
  if (qTerms.length === 0 || candidates.length === 0) return [];

  const docTokens = candidates.map((c) => tokenize(c.content));
  const headingTokens = candidates.map((c) => new Set(tokenize(`${c.title} ${c.sectionTitle ?? ""}`)));
  const N = candidates.length;
  const avgdl = docTokens.reduce((s, d) => s + d.length, 0) / N || 1;

  // Document frequency per query term (over the access-filtered candidate set).
  const df = new Map<string, number>();
  for (const t of qTerms) {
    let n = 0;
    for (const d of docTokens) if (d.includes(t)) n++;
    df.set(t, n);
  }

  const minCoverage = qTerms.length === 1 ? 1 : MIN_COVERAGE;
  const scored: Scored<T>[] = [];
  for (let i = 0; i < N; i++) {
    const tf = new Map<string, number>();
    for (const t of docTokens[i]) if (df.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    const dl = docTokens[i].length || 1;

    let score = 0;
    let matched = 0;
    for (const t of qTerms) {
      const f = tf.get(t) ?? 0;
      const inHeading = headingTokens[i].has(t);
      if (f === 0 && !inHeading) continue;
      matched++;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const norm = (f * (K1 + 1)) / (f + K1 * (1 - B + (B * dl) / avgdl));
      score += idf * norm;
      if (inHeading) score += idf * 0.75; // heading match is a strong relevance signal
    }
    const coverage = matched / qTerms.length;
    if (matched === 0 || coverage < minCoverage) continue;
    scored.push({ item: candidates[i], score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

// ---- retrieve ---------------------------------------------------------------

function toRetrieved(scored: Scored<KnowledgeChunk>[], k: number): RetrievedChunk[] {
  return scored.slice(0, k).map(({ item, score }) => ({
    chunk: item,
    score,
    citation: { title: item.title, sectionTitle: item.sectionTitle, href: item.href },
  }));
}

/**
 * Tag-scoped core: fetch non-retired chunks visible to `tags`, rank, return
 * top-k. No auth imports — callable from offline tooling with an explicit tag
 * set. `retrieve()` is the thin wrapper that resolves tags from the user.
 */
export async function retrieveForTags(
  query: string,
  tags: string[],
  opts: { k?: number; ranker?: Ranker<KnowledgeChunk> } = {},
): Promise<RetrievedChunk[]> {
  const k = opts.k ?? 6;
  const q = query.trim();
  if (!q || tags.length === 0) return [];
  const candidates = await prisma.knowledgeChunk.findMany({ where: { retired: false, accessTag: { in: tags } } });
  if (candidates.length === 0) return [];
  const rank = opts.ranker ?? bm25Rank;
  return toRetrieved(rank(q, candidates), k);
}

/**
 * Retrieve the top-k grounded passages for `query`, scoped to what `user` may
 * see. Returns [] when nothing clears the relevance gate (cite-or-decline).
 */
export async function retrieve(
  query: string,
  opts: { user: SessionUser; k?: number; ranker?: Ranker<KnowledgeChunk> },
): Promise<RetrievedChunk[]> {
  const tags = await accessTagsForUser(opts.user);
  return retrieveForTags(query, tags, { k: opts.k, ranker: opts.ranker });
}
