import type { KnowledgeChunkRepository } from "../repositories/knowledge-chunk-types.js";
import type {
  KnowledgeEntry,
  KnowledgeEntryUpdate,
  KnowledgeListFilter,
  KnowledgeRepository,
  NewKnowledgeEntry,
} from "../repositories/knowledge-types.js";
import { logger } from "../config/logger.js";
import { chunkKnowledgeContent } from "./knowledge-chunking.js";
import { EmbeddingProviderError, type EmbeddingProvider } from "./embedding-provider.js";

export interface KnowledgeService {
  listKnowledge(organizationId: string, filter?: KnowledgeListFilter): Promise<KnowledgeEntry[]>;
  createKnowledge(
    organizationId: string,
    input: Omit<NewKnowledgeEntry, "organizationId">,
  ): Promise<KnowledgeEntry>;
  /** undefined means "not found for this organization" — identical whether the id doesn't exist at all or belongs to a different organization. */
  updateKnowledge(
    organizationId: string,
    knowledgeId: string,
    changes: KnowledgeEntryUpdate,
  ): Promise<KnowledgeEntry | undefined>;
  deleteKnowledge(organizationId: string, knowledgeId: string): Promise<boolean>;
}

export function createKnowledgeService(
  repo: KnowledgeRepository,
  chunkRepo: KnowledgeChunkRepository,
  embeddingProvider: EmbeddingProvider,
): KnowledgeService {
  /**
   * M8: chunks + embeds one entry's current content and replaces whatever
   * chunks it had before. Never throws for a runtime embedding-provider
   * failure (EmbeddingProviderError) -- chunks are still persisted, just
   * with embedding: null for each, so the knowledge-entry write itself
   * always succeeds regardless of provider health (see the nullable
   * embedding column's own rationale in db/schema.ts). The failure is
   * logged as a warning first -- organization id, knowledge entry id, and
   * chunk count only (safe to log, matching this codebase's never-log
   * discipline), plus the error's own message (EmbeddingProviderError's
   * message never contains the API key or request headers -- see
   * embedding-provider.ts's hardening) -- so a provider outage is visible
   * in logs rather than silently degrading. A misconfigured provider
   * (EmbeddingConfigurationError) is NOT caught here -- it's expected to
   * have already failed at app construction time (createEmbeddingProvider()
   * validates eagerly), so if it somehow still reaches here it propagates
   * and fails the request, same as any other unexpected error.
   */
  async function reembedEntry(entry: KnowledgeEntry): Promise<void> {
    const chunks = chunkKnowledgeContent(entry.content);
    if (chunks.length === 0) {
      await chunkRepo.replaceChunksForKnowledgeEntry(entry.id, entry.organizationId, []);
      return;
    }

    let vectors: number[][] | null = null;
    try {
      vectors = await embeddingProvider.embed(chunks);
    } catch (err) {
      if (!(err instanceof EmbeddingProviderError)) throw err;
      logger.warn(
        {
          organizationId: entry.organizationId,
          knowledgeEntryId: entry.id,
          chunkCount: chunks.length,
          err: err.message,
        },
        "embedding provider failed; persisting knowledge chunks with null embeddings",
      );
      vectors = null;
    }

    await chunkRepo.replaceChunksForKnowledgeEntry(
      entry.id,
      entry.organizationId,
      chunks.map((content, i) => ({
        chunkIndex: i,
        content,
        embedding: vectors ? vectors[i]! : null,
      })),
    );
  }

  return {
    async listKnowledge(organizationId, filter) {
      return repo.listByOrganizationId(organizationId, filter);
    },

    async createKnowledge(organizationId, input) {
      const entry = await repo.create({ ...input, organizationId });
      await reembedEntry(entry);
      return entry;
    },

    async updateKnowledge(organizationId, knowledgeId, changes) {
      const entry = await repo.update(knowledgeId, organizationId, changes);
      if (entry && changes.content !== undefined) {
        await reembedEntry(entry);
      }
      return entry;
    },

    async deleteKnowledge(organizationId, knowledgeId) {
      const deleted = await repo.deleteByIdAndOrganizationId(knowledgeId, organizationId);
      if (deleted) {
        await chunkRepo.deleteByKnowledgeEntryId(knowledgeId, organizationId);
      }
      return deleted;
    },
  };
}
