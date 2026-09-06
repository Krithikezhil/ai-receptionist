import { describe, expect, it } from "vitest";
import type { KnowledgeChunk } from "../src/repositories/knowledge-chunk-types.js";
import type { KnowledgeEntry } from "../src/repositories/knowledge-types.js";
import {
  createEmbeddingProvider,
  EmbeddingProviderError,
  type EmbeddingProvider,
} from "../src/services/embedding-provider.js";
import { createKnowledgeService } from "../src/services/knowledge.service.js";
import {
  cosineSimilarity,
  DEFAULT_KNOWLEDGE_SEARCH_LIMIT,
  rankKnowledgeEntries,
  type RankableEntry,
} from "../src/services/knowledge-search.js";
import {
  createInMemoryKnowledgeChunkRepository,
  createInMemoryKnowledgeRepository,
} from "./support/in-memory-organization-repositories.js";

function makeEntry(id: string, title: string, content: string): KnowledgeEntry {
  return {
    id,
    organizationId: "org-a",
    title,
    content,
    category: "custom",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeChunk(entryId: string, embedding: number[] | null, content = "chunk"): KnowledgeChunk {
  return {
    id: `${entryId}-chunk`,
    knowledgeEntryId: entryId,
    organizationId: "org-a",
    chunkIndex: 0,
    content,
    embedding,
    createdAt: new Date(),
  };
}

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
  });

  it("returns 0 for a zero vector instead of NaN", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("throws on mismatched lengths", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length mismatch/);
  });
});

describe("rankKnowledgeEntries", () => {
  it("returns an empty array for no candidates", () => {
    expect(rankKnowledgeEntries([1], "q", [])).toEqual([]);
  });

  it("ranks semantically-scored entries by similarity, descending", () => {
    const query = [1, 0];
    const high = makeEntry("high", "High", "high content");
    const low = makeEntry("low", "Low", "low content");
    const candidates: RankableEntry[] = [
      { entry: low, chunks: [makeChunk("low", [0, 1])] },
      { entry: high, chunks: [makeChunk("high", [1, 0])] },
    ];
    const result = rankKnowledgeEntries(query, "irrelevant", candidates);
    expect(result.map((e) => e.id)).toEqual(["high", "low"]);
  });

  it("uses the max similarity across an entry's multiple chunks", () => {
    const query = [1, 0];
    const entry = makeEntry("e1", "Entry", "content");
    const candidates: RankableEntry[] = [
      { entry, chunks: [makeChunk("e1", [0, 1]), makeChunk("e1", [1, 0])] },
    ];
    const result = rankKnowledgeEntries(query, "irrelevant", candidates);
    expect(result).toEqual([entry]);
  });

  it("falls back to substring match for entries with zero usable-embedding chunks", () => {
    const query = [1, 0];
    const noEmbeddingEntry = makeEntry("e1", "Parking info", "Free parking behind the building.");
    const candidates: RankableEntry[] = [{ entry: noEmbeddingEntry, chunks: [makeChunk("e1", null)] }];
    const result = rankKnowledgeEntries(query, "parking", candidates);
    expect(result).toEqual([noEmbeddingEntry]);
  });

  it("excludes fallback entries that don't substring-match", () => {
    const query = [1, 0];
    const entry = makeEntry("e1", "Hours", "We are open 9 to 5.");
    const candidates: RankableEntry[] = [{ entry, chunks: [makeChunk("e1", null)] }];
    const result = rankKnowledgeEntries(query, "parking", candidates);
    expect(result).toEqual([]);
  });

  it("places semantic matches before fallback matches regardless of score", () => {
    const query = [1, 0];
    const semanticEntry = makeEntry("sem", "Semantic", "semantic content");
    const fallbackEntry = makeEntry("fb", "Fallback parking", "Free parking available.");
    const candidates: RankableEntry[] = [
      { entry: fallbackEntry, chunks: [makeChunk("fb", null)] },
      { entry: semanticEntry, chunks: [makeChunk("sem", [0, 1])] },
    ];
    const result = rankKnowledgeEntries(query, "parking", candidates);
    expect(result.map((e) => e.id)).toEqual(["sem", "fb"]);
  });

  it("caps the combined result at the limit, dropping fallback entries first", () => {
    const query = [1, 0];
    const semanticEntries = Array.from({ length: 3 }, (_, i) =>
      makeEntry(`sem-${i}`, `Semantic ${i}`, "content"),
    );
    const fallbackEntries = Array.from({ length: 3 }, (_, i) =>
      makeEntry(`fb-${i}`, `Fallback ${i}`, "parking content"),
    );
    const candidates: RankableEntry[] = [
      ...fallbackEntries.map((entry) => ({ entry, chunks: [makeChunk(entry.id, null)] })),
      ...semanticEntries.map((entry) => ({ entry, chunks: [makeChunk(entry.id, [1, 0])] })),
    ];
    const result = rankKnowledgeEntries(query, "parking", candidates, 4);
    expect(result).toHaveLength(4);
    expect(result.filter((e) => e.id.startsWith("sem-"))).toHaveLength(3);
    expect(result.filter((e) => e.id.startsWith("fb-"))).toHaveLength(1);
  });

  it("treats every candidate as fallback-only when queryVector is null", () => {
    const entryWithEmbedding = makeEntry("e1", "Parking", "Free parking here.");
    const candidates: RankableEntry[] = [{ entry: entryWithEmbedding, chunks: [makeChunk("e1", [1, 0])] }];
    const result = rankKnowledgeEntries(null, "parking", candidates);
    expect(result).toEqual([entryWithEmbedding]);
  });

  it("respects a custom limit", () => {
    expect(DEFAULT_KNOWLEDGE_SEARCH_LIMIT).toBe(5);
    const entries = Array.from({ length: 3 }, (_, i) => makeEntry(`e${i}`, `E${i}`, "content"));
    const candidates: RankableEntry[] = entries.map((entry) => ({
      entry,
      chunks: [makeChunk(entry.id, [1, 0])],
    }));
    const result = rankKnowledgeEntries([1, 0], "irrelevant", candidates, 2);
    expect(result).toHaveLength(2);
  });
});

describe("KnowledgeService.searchKnowledge", () => {
  const ORG_A = "11111111-1111-1111-1111-111111111111";
  const ORG_B = "22222222-2222-2222-2222-222222222222";

  function buildService(embeddingProvider: EmbeddingProvider = createEmbeddingProvider("fake")) {
    const knowledge = createInMemoryKnowledgeRepository();
    const knowledgeChunks = createInMemoryKnowledgeChunkRepository(knowledge);
    const service = createKnowledgeService(knowledge, knowledgeChunks, embeddingProvider);
    return { service, knowledge, knowledgeChunks };
  }

  it("missing q behaves identically to listKnowledge", async () => {
    const { service } = buildService();
    await service.createKnowledge(ORG_A, { title: "Hours", content: "We are open 9 to 5." });

    const viaSearch = await service.searchKnowledge(ORG_A, {});
    const viaList = await service.listKnowledge(ORG_A, {});
    expect(viaSearch).toEqual(viaList);
  });

  it("whitespace-only q behaves identically to listKnowledge and never calls embed", async () => {
    const embedCalls: string[][] = [];
    const spy: EmbeddingProvider = {
      embed: async (texts) => {
        embedCalls.push(texts);
        return texts.map(() => [0]);
      },
    };
    const { service } = buildService(spy);
    await service.createKnowledge(ORG_A, { title: "Hours", content: "We are open 9 to 5." });
    embedCalls.length = 0;

    const result = await service.searchKnowledge(ORG_A, { q: "   " });
    const viaList = await service.listKnowledge(ORG_A, { q: "   " });
    expect(result).toEqual(viaList);
    expect(embedCalls).toHaveLength(0);
  });

  it("applies category/active filters to candidates", async () => {
    const { service } = buildService();
    await service.createKnowledge(ORG_A, {
      title: "Hours",
      content: "We are open 9 to 5.",
      category: "faq",
    });
    await service.createKnowledge(ORG_A, {
      title: "Refunds",
      content: "Refunds within 30 days.",
      category: "policy",
    });

    const result = await service.searchKnowledge(ORG_A, { q: "days", category: "policy" });
    expect(result.map((e) => e.title)).toEqual(["Refunds"]);
  });

  it("falls back to substring matching when the embedding provider fails", async () => {
    const throwingProvider: EmbeddingProvider = {
      embed: async () => {
        throw new EmbeddingProviderError("simulated outage");
      },
    };
    const { service } = buildService(throwingProvider);
    await service.createKnowledge(ORG_A, {
      title: "Parking",
      content: "Free parking behind the building.",
    });
    await service.createKnowledge(ORG_A, { title: "Hours", content: "We are open 9 to 5." });

    const result = await service.searchKnowledge(ORG_A, { q: "parking" });
    expect(result.map((e) => e.title)).toEqual(["Parking"]);
  });

  it("propagates unexpected (non-EmbeddingProviderError) errors", async () => {
    const knowledge = createInMemoryKnowledgeRepository();
    const knowledgeChunks = createInMemoryKnowledgeChunkRepository(knowledge);
    const workingService = createKnowledgeService(
      knowledge,
      knowledgeChunks,
      createEmbeddingProvider("fake"),
    );
    await workingService.createKnowledge(ORG_A, { title: "Hours", content: "We are open 9 to 5." });

    const throwingProvider: EmbeddingProvider = {
      embed: async () => {
        throw new Error("boom");
      },
    };
    const searchService = createKnowledgeService(knowledge, knowledgeChunks, throwingProvider);
    await expect(searchService.searchKnowledge(ORG_A, { q: "hours" })).rejects.toThrow("boom");
  });

  it("caps results at DEFAULT_KNOWLEDGE_SEARCH_LIMIT", async () => {
    const { service } = buildService();
    for (let i = 0; i < 8; i++) {
      await service.createKnowledge(ORG_A, {
        title: `Entry ${i}`,
        content: `Content number ${i} about hours.`,
      });
    }
    const result = await service.searchKnowledge(ORG_A, { q: "hours" });
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("cross-tenant isolation: org B's entries never appear in org A's search results", async () => {
    const { service } = buildService();
    await service.createKnowledge(ORG_A, { title: "A entry", content: "Org A content about parking." });
    await service.createKnowledge(ORG_B, { title: "B entry", content: "Org B content about parking." });

    const result = await service.searchKnowledge(ORG_A, { q: "parking" });
    expect(result.every((e) => e.organizationId === ORG_A)).toBe(true);
    expect(result.some((e) => e.title === "B entry")).toBe(false);
  });
});
