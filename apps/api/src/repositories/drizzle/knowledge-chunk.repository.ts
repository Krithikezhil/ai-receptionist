import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { knowledgeChunks, knowledgeEntries } from "../../db/schema.js";
import type { KnowledgeChunk, KnowledgeChunkRepository } from "../knowledge-chunk-types.js";

function toDomain(row: typeof knowledgeChunks.$inferSelect): KnowledgeChunk {
  return {
    id: row.id,
    knowledgeEntryId: row.knowledgeEntryId,
    organizationId: row.organizationId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    embedding: row.embedding,
    createdAt: row.createdAt,
  };
}

export function createDrizzleKnowledgeChunkRepository(db: Database): KnowledgeChunkRepository {
  return {
    async replaceChunksForKnowledgeEntry(knowledgeEntryId, organizationId, chunks) {
      return db.transaction(async (tx) => {
        const [entry] = await tx
          .select({ id: knowledgeEntries.id })
          .from(knowledgeEntries)
          .where(
            and(
              eq(knowledgeEntries.id, knowledgeEntryId),
              eq(knowledgeEntries.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!entry) {
          throw new Error(
            `Cannot persist chunks for knowledge entry ${knowledgeEntryId}: it does not belong to organization ${organizationId}.`,
          );
        }

        await tx
          .delete(knowledgeChunks)
          .where(
            and(
              eq(knowledgeChunks.knowledgeEntryId, knowledgeEntryId),
              eq(knowledgeChunks.organizationId, organizationId),
            ),
          );

        if (chunks.length === 0) return [];

        const rows = await tx
          .insert(knowledgeChunks)
          .values(
            chunks.map((chunk) => ({
              knowledgeEntryId,
              organizationId,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              embedding: chunk.embedding,
            })),
          )
          .returning();
        return rows.map(toDomain);
      });
    },

    async listByKnowledgeEntryId(knowledgeEntryId, organizationId) {
      const rows = await db
        .select()
        .from(knowledgeChunks)
        .where(
          and(
            eq(knowledgeChunks.knowledgeEntryId, knowledgeEntryId),
            eq(knowledgeChunks.organizationId, organizationId),
          ),
        );
      return rows.map(toDomain);
    },

    async deleteByKnowledgeEntryId(knowledgeEntryId, organizationId) {
      await db
        .delete(knowledgeChunks)
        .where(
          and(
            eq(knowledgeChunks.knowledgeEntryId, knowledgeEntryId),
            eq(knowledgeChunks.organizationId, organizationId),
          ),
        );
    },
  };
}
