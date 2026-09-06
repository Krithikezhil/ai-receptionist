import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmbeddingProvider,
  EmbeddingConfigurationError,
  EmbeddingProviderError,
  EMBEDDING_DIMENSIONS,
} from "../src/services/embedding-provider.js";

/** A valid-length filler embedding for happy-path response mocks -- values
 * don't matter for these tests, only that the length matches what
 * openaiEmbed() requires (EMBEDDING_DIMENSIONS). */
function validEmbedding(seed = 0): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i + seed) / 1000);
}

describe("createEmbeddingProvider('fake')", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is deterministic: the same text always produces the same vector", async () => {
    const provider = createEmbeddingProvider("fake");
    const [a] = await provider.embed(["hello world"]);
    const [b] = await provider.embed(["hello world"]);
    expect(a).toEqual(b);
  });

  it("produces a different vector for different text", async () => {
    const provider = createEmbeddingProvider("fake");
    const [a] = await provider.embed(["hello"]);
    const [b] = await provider.embed(["goodbye"]);
    expect(a).not.toEqual(b);
  });

  it("returns EMBEDDING_DIMENSIONS-length vectors, matching the real provider's shape", async () => {
    const provider = createEmbeddingProvider("fake");
    const [vector] = await provider.embed(["anything"]);
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("preserves per-item correspondence in a batch (not just count)", async () => {
    const provider = createEmbeddingProvider("fake");
    const [aAlone] = await provider.embed(["a"]);
    const [bAlone] = await provider.embed(["b"]);
    const batch = await provider.embed(["a", "b"]);
    expect(batch).toHaveLength(2);
    expect(batch[0]).toEqual(aAlone);
    expect(batch[1]).toEqual(bAlone);
  });

  it("never makes a network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createEmbeddingProvider("fake");
    await provider.embed(["hello"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("createEmbeddingProvider('openai')", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws EmbeddingConfigurationError when apiKey is missing", () => {
    expect(() => createEmbeddingProvider("openai", { model: "text-embedding-3-small" })).toThrow(
      EmbeddingConfigurationError,
    );
    expect(() => createEmbeddingProvider("openai", { model: "text-embedding-3-small" })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it("throws EmbeddingConfigurationError when model is missing", () => {
    expect(() => createEmbeddingProvider("openai", { apiKey: "test-key-do-not-use" })).toThrow(
      EmbeddingConfigurationError,
    );
    expect(() => createEmbeddingProvider("openai", { apiKey: "test-key-do-not-use" })).toThrow(
      /OPENAI_EMBEDDING_MODEL/,
    );
  });

  it("sends the expected request shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: validEmbedding() }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-small",
    });
    await provider.embed(["hello"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key-do-not-use",
          "Content-Type": "application/json",
        }),
      }),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      input: ["hello"],
      model: "text-embedding-3-small",
    });
  });

  it("uses the model passed in options, not any internal default", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: validEmbedding() }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-large",
    });
    await provider.embed(["hello"]);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).model).toBe("text-embedding-3-large");
  });

  it("re-orders the response by index and returns embeddings in request order", async () => {
    const first = validEmbedding(1);
    const second = validEmbedding(2);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: second },
          { index: 0, embedding: first },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-small",
    });
    const vectors = await provider.embed(["first", "second"]);
    expect(vectors).toEqual([first, second]);
  });

  it("throws EmbeddingProviderError on a non-ok response without leaking the request", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-small",
    });
    await expect(provider.embed(["hello"])).rejects.toThrow(EmbeddingProviderError);
    await expect(provider.embed(["hello"])).rejects.toThrow(/401/);
  });

  it("throws EmbeddingProviderError on a malformed response shape (wrong count)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-small",
    });
    await expect(provider.embed(["hello"])).rejects.toThrow(EmbeddingProviderError);
  });

  it("throws EmbeddingProviderError when an embedding is not a numeric array", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: "not-an-array" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-small",
    });
    await expect(provider.embed(["hello"])).rejects.toThrow(EmbeddingProviderError);
  });

  it("throws EmbeddingProviderError when an embedding has the wrong dimension count", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [1, 2, 3] }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-small",
    });
    await expect(provider.embed(["hello"])).rejects.toThrow(EmbeddingProviderError);
    await expect(provider.embed(["hello"])).rejects.toThrow(/1536/);
  });

  it("throws EmbeddingProviderError when embeddings in one batch have inconsistent lengths", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { index: 0, embedding: validEmbedding() },
          { index: 1, embedding: [1, 2] },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-small",
    });
    await expect(provider.embed(["a", "b"])).rejects.toThrow(EmbeddingProviderError);
  });

  it("never exposes the API key in a thrown error message", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "super-secret-value",
      model: "text-embedding-3-small",
    });
    await expect(provider.embed(["hello"])).rejects.not.toThrow(/super-secret-value/);
  });

  it("throws EmbeddingProviderError when fetch itself rejects (network failure)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-small",
    });

    const result = provider.embed(["hello"]);
    await expect(result).rejects.toBeInstanceOf(EmbeddingProviderError);
    await expect(result).rejects.toThrow(/fetch failed/);
  });

  it("throws EmbeddingProviderError when the response body is not valid JSON", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "test-key-do-not-use",
      model: "text-embedding-3-small",
    });
    await expect(provider.embed(["hello"])).rejects.toThrow(EmbeddingProviderError);
  });

  it("never exposes the API key when fetch itself rejects", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createEmbeddingProvider("openai", {
      apiKey: "super-secret-value",
      model: "text-embedding-3-small",
    });
    await expect(provider.embed(["hello"])).rejects.not.toThrow(/super-secret-value/);
  });
});

describe("createEmbeddingProvider(unrecognized)", () => {
  it("throws EmbeddingConfigurationError naming the bad value", () => {
    expect(() => createEmbeddingProvider("bogus")).toThrow(EmbeddingConfigurationError);
    expect(() => createEmbeddingProvider("bogus")).toThrow(/EMBEDDING_PROVIDER/);
  });
});
