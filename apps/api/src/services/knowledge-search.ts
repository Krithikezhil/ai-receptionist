import type { KnowledgeChunk } from "../repositories/knowledge-chunk-types.js";
import type { KnowledgeEntry } from "../repositories/knowledge-types.js";

/**
 * M8 Step 5: caps ranked knowledge-search results. Kept small since this
 * feeds an LLM tool-call response, not a browsable list -- the voice agent
 * only needs the most relevant few entries per question.
 */
export const DEFAULT_KNOWLEDGE_SEARCH_LIMIT = 5;

/**
 * Standard cosine similarity, range [-1, 1] for non-zero vectors. Throws on
 * mismatched lengths rather than silently producing a meaningless number --
 * every embedding compared here should come from the same EmbeddingProvider
 * instance (see EMBEDDING_DIMENSIONS in embedding-provider.ts), so a length
 * mismatch means something is already wrong upstream.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: vector length mismatch (${a.length} vs ${b.length}).`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface RankableEntry {
  entry: KnowledgeEntry;
  chunks: KnowledgeChunk[];
}

/**
 * M8 Step 5: the entire ranking algorithm lives here, not in
 * knowledge.service.ts -- the service only fetches data and calls this.
 *
 * An entry is scored semantically if it has at least one chunk with a
 * non-null embedding (max cosine similarity across those chunks). An entry
 * with zero usable-embedding chunks -- no chunks at all, or every chunk's
 * embedding is null because a prior write-time EmbeddingProviderError left
 * it that way (see knowledge.service.ts's reembedEntry) -- falls back to a
 * case-insensitive substring match against title/content, the same check
 * the pre-Step-5 q filter used. queryVector is null when the query itself
 * couldn't be embedded (see knowledge.service.ts) -- in that case every
 * candidate is evaluated via the substring fallback only.
 *
 * Semantic matches are sorted by score (descending) and always placed
 * ahead of substring-fallback matches; the combined list is then capped at
 * `limit` -- fallback entries cannot bypass the cap.
 */
export function rankKnowledgeEntries(
  queryVector: number[] | null,
  query: string,
  candidates: RankableEntry[],
  limit: number = DEFAULT_KNOWLEDGE_SEARCH_LIMIT,
): KnowledgeEntry[] {
  const needle = query.toLowerCase();
  const semantic: { entry: KnowledgeEntry; score: number }[] = [];
  const fallback: KnowledgeEntry[] = [];

  for (const { entry, chunks } of candidates) {
    const usable = queryVector
      ? chunks.filter((c): c is KnowledgeChunk & { embedding: number[] } => c.embedding !== null)
      : [];

    if (queryVector && usable.length > 0) {
      const score = Math.max(...usable.map((c) => cosineSimilarity(queryVector, c.embedding)));
      semantic.push({ entry, score });
    } else if (
      entry.title.toLowerCase().includes(needle) ||
      entry.content.toLowerCase().includes(needle)
    ) {
      fallback.push(entry);
    }
  }

  semantic.sort((a, b) => b.score - a.score);
  return [...semantic.map((s) => s.entry), ...fallback].slice(0, limit);
}
