import { describe, expect, it } from "vitest";
import {
  createEmbeddingProvider,
  EmbeddingProviderError,
  type EmbeddingProvider,
} from "../src/services/embedding-provider.js";
import { createKnowledgeService } from "../src/services/knowledge.service.js";
import {
  createInMemoryKnowledgeChunkRepository,
  createInMemoryKnowledgeRepository,
} from "./support/in-memory-organization-repositories.js";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

function buildService(embeddingProvider: EmbeddingProvider = createEmbeddingProvider("fake")) {
  const knowledge = createInMemoryKnowledgeRepository();
  const knowledgeChunks = createInMemoryKnowledgeChunkRepository(knowledge);
  const service = createKnowledgeService(knowledge, knowledgeChunks, embeddingProvider);
  return { service, knowledge, knowledgeChunks };
}

describe("knowledge chunk + embedding wiring (M8 Step 4)", () => {
  it("create: produces chunks with non-null embeddings", async () => {
    const { service, knowledgeChunks } = buildService();
    const entry = await service.createKnowledge(ORG_A, {
      title: "Hours",
      content: "We are open Monday to Friday, 9am to 5pm.",
    });

    const chunks = await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.embedding).not.toBeNull();
      expect(chunk.organizationId).toBe(ORG_A);
    }
  });

  it("content-changing update: replaces old chunks with new ones", async () => {
    const { service, knowledgeChunks } = buildService();
    const entry = await service.createKnowledge(ORG_A, {
      title: "Hours",
      content: "We are open Monday to Friday.",
    });
    const before = await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A);

    const updated = await service.updateKnowledge(ORG_A, entry.id, {
      content: "We are open every day, including weekends.",
    });
    const after = await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A);

    expect(updated).toBeDefined();
    expect(after.map((c) => c.id)).not.toEqual(before.map((c) => c.id));
    expect(after.map((c) => c.content)).not.toEqual(before.map((c) => c.content));
    expect(after.every((c) => c.embedding !== null)).toBe(true);
  });

  it("metadata-only update: leaves existing chunks untouched", async () => {
    const { service, knowledgeChunks } = buildService();
    const entry = await service.createKnowledge(ORG_A, {
      title: "Hours",
      content: "We are open Monday to Friday.",
    });
    const before = await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A);

    await service.updateKnowledge(ORG_A, entry.id, { active: false });
    const after = await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A);

    expect(after).toEqual(before);
  });

  it("delete: leaves no orphan chunks", async () => {
    const { service, knowledgeChunks } = buildService();
    const entry = await service.createKnowledge(ORG_A, {
      title: "Hours",
      content: "We are open Monday to Friday.",
    });
    expect((await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A)).length).toBeGreaterThan(0);

    const deleted = await service.deleteKnowledge(ORG_A, entry.id);
    expect(deleted).toBe(true);
    expect(await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A)).toEqual([]);
  });

  it("EmbeddingProviderError: knowledge entry still succeeds, chunks persisted with null embeddings", async () => {
    const throwingProvider: EmbeddingProvider = {
      embed: async () => {
        throw new EmbeddingProviderError("simulated provider outage");
      },
    };
    const { service, knowledgeChunks } = buildService(throwingProvider);

    const entry = await service.createKnowledge(ORG_A, {
      title: "Hours",
      content: "We are open Monday to Friday.",
    });

    const chunks = await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.embedding === null)).toBe(true);
  });

  it("cross-tenant isolation: org B cannot see or delete org A's chunks", async () => {
    const { service, knowledgeChunks } = buildService();
    const entry = await service.createKnowledge(ORG_A, {
      title: "Hours",
      content: "We are open Monday to Friday.",
    });

    expect(await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_B)).toEqual([]);

    const deletedAsOrgB = await service.deleteKnowledge(ORG_B, entry.id);
    expect(deletedAsOrgB).toBe(false);
    expect((await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A)).length).toBeGreaterThan(0);
  });

  it("zero-chunk direct service path: clears existing chunks and never calls embed([])", async () => {
    const embedCalls: string[][] = [];
    const spyProvider: EmbeddingProvider = {
      embed: async (texts) => {
        embedCalls.push(texts);
        return texts.map(() => [0]);
      },
    };
    const { service, knowledgeChunks } = buildService(spyProvider);

    const entry = await service.createKnowledge(ORG_A, {
      title: "Hours",
      content: "We are open Monday to Friday.",
    });
    expect((await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A)).length).toBeGreaterThan(0);
    const callsBeforeZeroChunkUpdate = embedCalls.length;

    // Bypasses createKnowledgeSchema's .trim().min(1) validation on purpose --
    // that HTTP-level check makes whitespace-only content unreachable via the
    // public API (see validation/knowledge.schemas.ts), but knowledgeService
    // itself takes a plain string with no such guarantee, so it must still
    // behave correctly if ever called directly this way.
    await service.updateKnowledge(ORG_A, entry.id, { content: "   " });

    expect(embedCalls.length).toBe(callsBeforeZeroChunkUpdate);
    expect(await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A)).toEqual([]);
  });

  it("repository: replaceChunksForKnowledgeEntry rejects a knowledgeEntryId/organizationId mismatch", async () => {
    const { service, knowledgeChunks } = buildService();
    const entry = await service.createKnowledge(ORG_A, {
      title: "Hours",
      content: "We are open Monday to Friday.",
    });
    const before = await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A);
    expect(before.length).toBeGreaterThan(0);

    await expect(
      knowledgeChunks.replaceChunksForKnowledgeEntry(entry.id, ORG_B, [
        { chunkIndex: 0, content: "malicious chunk", embedding: null },
      ]),
    ).rejects.toThrow(/does not belong to organization/);

    const after = await knowledgeChunks.listByKnowledgeEntryId(entry.id, ORG_A);
    expect(after).toEqual(before);
  });
});
