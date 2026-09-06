export interface KnowledgeChunk {
  id: string;
  knowledgeEntryId: string;
  organizationId: string;
  chunkIndex: number;
  content: string;
  embedding: number[] | null;
  createdAt: Date;
}

export interface NewKnowledgeChunk {
  chunkIndex: number;
  content: string;
  embedding: number[] | null;
}

export interface KnowledgeChunkRepository {
  /**
   * Replaces the full chunk set for one knowledge entry: deletes existing
   * chunks (scoped by BOTH knowledgeEntryId and organizationId -- tenant
   * isolation for the delete, not just the insert) and inserts the new set,
   * in one transaction. Verifies knowledgeEntryId actually belongs to
   * organizationId before writing anything -- knowledge_chunks has two
   * independent single-column foreign keys (knowledgeEntryId ->
   * knowledge_entries.id, organizationId -> organizations.id), not a
   * composite FK, so nothing at the database level stops a caller from
   * pairing a valid knowledgeEntryId with the wrong organizationId. This
   * check is what actually prevents that -- see
   * drizzle/knowledge-chunk.repository.ts.
   */
  replaceChunksForKnowledgeEntry(
    knowledgeEntryId: string,
    organizationId: string,
    chunks: NewKnowledgeChunk[],
  ): Promise<KnowledgeChunk[]>;
  /**
   * Tenant-scoped by both ids, same as every delete in this codebase. Used
   * by knowledge.service.ts's deleteKnowledge -- explicit application-level
   * cleanup, not solely relied on the Step 1 ON DELETE CASCADE FK, so
   * behavior is identical and independently testable on both the real and
   * in-memory repositories.
   */
  deleteByKnowledgeEntryId(knowledgeEntryId: string, organizationId: string): Promise<void>;
  /**
   * Read access, tenant-scoped. No HTTP endpoint exposes this in M8 Step 4
   * (no routes/controllers added) -- it exists purely so tests (and a
   * future retrieval milestone) can query chunks directly.
   */
  listByKnowledgeEntryId(knowledgeEntryId: string, organizationId: string): Promise<KnowledgeChunk[]>;
  /**
   * M8 Step 5: all of an organization's chunks in one query -- the
   * "brute-force in application code" retrieval design (no pgvector; see
   * the M8 architecture decision). Used only by knowledge-search.ts's
   * ranking, called from knowledge.service.ts's searchKnowledge; no HTTP
   * endpoint exposes this directly.
   */
  listByOrganizationId(organizationId: string): Promise<KnowledgeChunk[]>;
}
