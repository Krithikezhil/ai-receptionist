import { describe, expect, it } from "vitest";
import { chunkKnowledgeContent, DEFAULT_MAX_CHUNK_LENGTH } from "../src/services/knowledge-chunking.js";

describe("chunkKnowledgeContent", () => {
  it("returns an empty array for empty content", () => {
    expect(chunkKnowledgeContent("")).toEqual([]);
  });

  it("returns an empty array for whitespace-only content", () => {
    expect(chunkKnowledgeContent("   \n\n\t  ")).toEqual([]);
  });

  it("returns a single trimmed chunk for short content", () => {
    expect(chunkKnowledgeContent("  Hello world.  ")).toEqual(["Hello world."]);
  });

  it("splits on paragraph boundaries, preserving order", () => {
    const content = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    expect(chunkKnowledgeContent(content)).toEqual([
      "First paragraph.",
      "Second paragraph.",
      "Third paragraph.",
    ]);
  });

  it("treats single newlines within a paragraph as not a paragraph break", () => {
    const content = "Line one.\nLine two.";
    expect(chunkKnowledgeContent(content)).toEqual(["Line one.\nLine two."]);
  });

  it("splits a too-long paragraph on sentence boundaries", () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `This is sentence number ${i}.`);
    const paragraph = sentences.join(" ");
    const chunks = chunkKnowledgeContent(paragraph, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(50);
    // no words lost or reordered
    expect(chunks.join(" ")).toBe(paragraph);
  });

  it("hard-splits a single 'sentence' with no punctuation that exceeds maxChunkLength", () => {
    const noPunctuation = "a".repeat(25);
    const chunks = chunkKnowledgeContent(noPunctuation, 10);
    expect(chunks).toEqual(["aaaaaaaaaa", "aaaaaaaaaa", "aaaaa"]);
  });

  it("never returns a chunk longer than the requested maxChunkLength", () => {
    const content = "word ".repeat(500).trim();
    const chunks = chunkKnowledgeContent(content, 100);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
  });

  it("uses DEFAULT_MAX_CHUNK_LENGTH when no explicit length is given", () => {
    const content = "word ".repeat(1000).trim();
    const chunks = chunkKnowledgeContent(content);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(DEFAULT_MAX_CHUNK_LENGTH);
  });

  it("does not throw on unicode content and returns a non-empty result", () => {
    const chunks = chunkKnowledgeContent("café résumé naïve 日本語のテキスト 🎉🎉🎉");
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("never returns an empty-string chunk", () => {
    const content = "First.\n\n\n\nSecond.";
    const chunks = chunkKnowledgeContent(content);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  it("is deterministic: same input always produces the same output", () => {
    const content = "Some knowledge base content.\n\nWith multiple paragraphs, some long, some short.";
    expect(chunkKnowledgeContent(content)).toEqual(chunkKnowledgeContent(content));
  });

  it("rejects zero", () => {
    expect(() => chunkKnowledgeContent("hello", 0)).toThrow(
      "maxChunkLength must be a positive integer, got 0.",
    );
  });

  it("rejects negative values", () => {
    expect(() => chunkKnowledgeContent("hello", -5)).toThrow(/positive integer/);
  });

  it("rejects non-integer (float) values", () => {
    expect(() => chunkKnowledgeContent("hello", 50.5)).toThrow(
      "maxChunkLength must be a positive integer, got 50.5.",
    );
  });

  it("rejects NaN", () => {
    expect(() => chunkKnowledgeContent("hello", Number.NaN)).toThrow(
      "maxChunkLength must be a positive integer, got NaN.",
    );
  });

  it("rejects Infinity", () => {
    expect(() => chunkKnowledgeContent("hello", Number.POSITIVE_INFINITY)).toThrow(
      "maxChunkLength must be a positive integer, got Infinity.",
    );
  });

  it("rejects -Infinity", () => {
    expect(() => chunkKnowledgeContent("hello", Number.NEGATIVE_INFINITY)).toThrow(
      "maxChunkLength must be a positive integer, got -Infinity.",
    );
  });
});
