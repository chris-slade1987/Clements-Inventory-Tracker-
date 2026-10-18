import { prisma } from "@/lib/prisma";
import { loadCorpus, type CorpusChunk } from "@/lib/copilot/corpus";

// Canopy Copilot — continuous ingestion (Theme 5, Wave A, §5).
//
// `reindexKnowledge()` walks the corpus (lib/copilot/corpus.ts), upserts each
// chunk into `KnowledgeChunk` keyed by (sourceType, sourceId, contentHash), and
// SOFT-removes (`retired = true`) any previously-indexed chunk of a re-loaded
// source that the corpus no longer produces. Nothing is ever hard-deleted, so
// the ledger of what the index held is preserved (CLAUDE.md append-only rule).
//
// IDEMPOTENT: a second run makes zero writes — every current chunk already
// exists with a matching hash and unchanged mutable fields, and nothing new is
// retired.

export type ReindexResult = {
  scanned: number; // chunks produced by the corpus this run
  created: number; // new chunk rows
  updated: number; // existing rows whose mutable fields (href/accessTag/section/tokens) changed, or that were un-retired
  unchanged: number; // existing rows left exactly as-is
  retired: number; // rows soft-removed because the corpus no longer produces them
  sources: number; // distinct (sourceType, sourceId) sources seen
};

const sourceKey = (sourceType: string, sourceId: string) => `${sourceType}\u0000${sourceId}`;

/**
 * Rebuild the knowledge index from the corpus. Safe to call repeatedly (deploy,
 * nightly, or on a content-publish hook). Best-effort callers should still wrap
 * it in try/catch — it throws only on an unexpected DB error.
 */
export async function reindexKnowledge(): Promise<ReindexResult> {
  const chunks = await loadCorpus();

  // Group the freshly-loaded chunks by their source.
  const bySource = new Map<string, CorpusChunk[]>();
  for (const c of chunks) {
    const key = sourceKey(c.sourceType, c.sourceId);
    (bySource.get(key) ?? bySource.set(key, []).get(key)!).push(c);
  }

  const result: ReindexResult = { scanned: chunks.length, created: 0, updated: 0, unchanged: 0, retired: 0, sources: bySource.size };

  // Reconcile each loaded source: upsert its current chunks, retire the rest.
  for (const [, group] of bySource) {
    const { sourceType, sourceId } = group[0];
    const existing = await prisma.knowledgeChunk.findMany({ where: { sourceType, sourceId } });
    const existingByHash = new Map(existing.map((e) => [e.contentHash, e]));
    const seenHashes = new Set<string>();

    for (const c of group) {
      seenHashes.add(c.contentHash);
      const prev = existingByHash.get(c.contentHash);
      if (!prev) {
        await prisma.knowledgeChunk.create({
          data: {
            sourceType: c.sourceType,
            sourceId: c.sourceId,
            title: c.title,
            sectionTitle: c.sectionTitle,
            href: c.href,
            accessTag: c.accessTag,
            content: c.text,
            contentHash: c.contentHash,
            tokens: c.tokens,
            retired: false,
          },
        });
        result.created++;
        continue;
      }
      // Same content (hash) — only write if a mutable field drifted or it was retired.
      const needsUpdate =
        prev.retired ||
        prev.href !== c.href ||
        prev.accessTag !== c.accessTag ||
        prev.title !== c.title ||
        prev.sectionTitle !== c.sectionTitle ||
        prev.tokens !== c.tokens;
      if (needsUpdate) {
        await prisma.knowledgeChunk.update({
          where: { id: prev.id },
          data: { href: c.href, accessTag: c.accessTag, title: c.title, sectionTitle: c.sectionTitle, tokens: c.tokens, retired: false },
        });
        result.updated++;
      } else {
        result.unchanged++;
      }
    }

    // Soft-remove live chunks of this source the corpus no longer produces.
    for (const e of existing) {
      if (!seenHashes.has(e.contentHash) && !e.retired) {
        await prisma.knowledgeChunk.update({ where: { id: e.id }, data: { retired: true } });
        result.retired++;
      }
    }
  }

  // Retire chunks of sources that disappeared entirely (no longer loaded at all).
  const liveSources = new Set(Array.from(bySource.values()).map((g) => sourceKey(g[0].sourceType, g[0].sourceId)));
  const orphans = await prisma.knowledgeChunk.findMany({ where: { retired: false } });
  for (const o of orphans) {
    if (!liveSources.has(sourceKey(o.sourceType, o.sourceId))) {
      await prisma.knowledgeChunk.update({ where: { id: o.id }, data: { retired: true } });
      result.retired++;
    }
  }

  return result;
}

/** How many live (non-retired) chunks are indexed. Cheap readiness check. */
export async function knowledgeChunkCount(): Promise<number> {
  return prisma.knowledgeChunk.count({ where: { retired: false } });
}
