import { createHash } from "node:crypto";

/**
 * M8: turns chunk text into vectors. "fake" (deterministic, no network) is
 * the default -- every automated test runs against it, exactly mirroring
 * services/voice-agent's STT/LLM/TTS provider convention
 * (providers/factory.py: "fake" is the default for every role... a real
 * provider additionally requires its matching API key"). "openai" is the
 * only real provider for M8 -- a direct REST call via the built-in global
 * fetch, no SDK (apps/api has zero HTTP-client dependency today and a single
 * embeddings call doesn't justify adding one).
 *
 * EMBEDDING_DIMENSIONS is shared by both providers on purpose: it matches
 * text-embedding-3-small's native output size (1536), so fake- and
 * real-provider vectors are always structurally interchangeable -- nothing
 * downstream (storage, similarity math) ever needs to special-case which
 * provider produced a given vector. The real provider path enforces this
 * exactly (see openaiEmbed) -- the database column itself (a plain
 * Postgres real[], not pgvector's dimension-typed vector(N)) enforces
 * nothing, so this module is the only place dimension consistency is
 * actually protected. Known, accepted limitation: if OPENAI_EMBEDDING_MODEL
 * is ever changed to a model with a different native dimension, this
 * constant must be updated to match AND every previously-stored real
 * embedding must be regenerated -- not solved here, not silently hidden
 * either (openaiEmbed's error message says so directly).
 */
export interface EmbeddingProvider {
  /** Batch-first: OpenAI's endpoint accepts an array natively at no extra
   * cost, and Step 4 will always have multiple chunks per knowledge entry
   * to embed in one call. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Something is wrong with how this was set up: an unrecognized provider
 * name, or "openai" selected without its required apiKey/model. Mirrors
 * providers/factory.py's ProviderConfigurationError scope exactly -- never
 * thrown for a request that was sent and failed at runtime. */
export class EmbeddingConfigurationError extends Error {}

/** The request was sent but failed, or the response was malformed --
 * distinct from EmbeddingConfigurationError, which is only ever about setup. */
export class EmbeddingProviderError extends Error {}

export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Deterministic, no-network, dependency-free: the same text always produces
 * the same vector (SHA-256 of the text, mapped into EMBEDDING_DIMENSIONS
 * floats in [-1, 1]). Not meant to produce semantically meaningful
 * similarity -- only meant to let every other piece of M8 be built and
 * tested without a real provider, the same role FakeSTTService/
 * FakeLLMService/FakeTTSService play in services/voice-agent.
 */
function fakeEmbed(text: string): number[] {
  const hash = createHash("sha256").update(text, "utf8").digest();
  const vector: number[] = [];
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    const byte = hash[i % hash.length]!;
    vector.push((byte / 255) * 2 - 1);
  }
  return vector;
}

interface OpenAiEmbeddingItem {
  index: number;
  embedding: unknown;
}

interface OpenAiEmbeddingResponse {
  data: OpenAiEmbeddingItem[];
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

async function openaiEmbed(texts: string[], apiKey: string, model: string): Promise<number[][]> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input: texts, model }),
    });
  } catch (err) {
    // fetch() itself rejected -- network/DNS/connection failure, before any
    // response existed. err here is a generic network-layer error (e.g.
    // "fetch failed", ECONNREFUSED) -- never anything derived from the
    // request body/headers, so its message is safe to include.
    throw new EmbeddingProviderError(
      `OpenAI embeddings request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    // Status text only -- never the request body/headers, which carry the
    // API key. Matches this codebase's never-log discipline.
    throw new EmbeddingProviderError(
      `OpenAI embeddings request failed: ${response.status} ${response.statusText}`,
    );
  }

  let body: OpenAiEmbeddingResponse;
  try {
    body = (await response.json()) as OpenAiEmbeddingResponse;
  } catch (err) {
    // Same class of gap as the fetch() rejection above: a non-JSON response
    // body would otherwise reject with an uncaught SyntaxError instead of
    // EmbeddingProviderError.
    throw new EmbeddingProviderError(
      `OpenAI embeddings response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(body.data) || body.data.length !== texts.length) {
    throw new EmbeddingProviderError(
      "OpenAI embeddings response did not contain the expected number of embeddings.",
    );
  }

  const sorted = [...body.data].sort((a, b) => a.index - b.index);
  const embeddings: number[][] = [];
  for (const item of sorted) {
    if (!isFiniteNumberArray(item.embedding)) {
      throw new EmbeddingProviderError(
        "OpenAI embeddings response contained a non-numeric or malformed embedding.",
      );
    }
    if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingProviderError(
        `OpenAI embeddings response contained a ${item.embedding.length}-dimensional embedding, ` +
          `expected ${EMBEDDING_DIMENSIONS}. If OPENAI_EMBEDDING_MODEL was changed to a model with a ` +
          "different native output size, EMBEDDING_DIMENSIONS in embedding-provider.ts must be updated " +
          "and every previously-stored embedding regenerated.",
      );
    }
    embeddings.push(item.embedding);
  }

  return embeddings;
}

export function createEmbeddingProvider(
  provider: string,
  options: { apiKey?: string | undefined; model?: string | undefined } = {},
): EmbeddingProvider {
  if (provider === "fake") {
    return { embed: (texts) => Promise.resolve(texts.map(fakeEmbed)) };
  }

  if (provider === "openai") {
    if (!options.apiKey) {
      throw new EmbeddingConfigurationError(
        "OPENAI_API_KEY is not set — required because EMBEDDING_PROVIDER=openai is selected. See .env.example.",
      );
    }
    if (!options.model) {
      throw new EmbeddingConfigurationError(
        "OPENAI_EMBEDDING_MODEL is not set — required because EMBEDDING_PROVIDER=openai is selected. See .env.example.",
      );
    }
    const apiKey = options.apiKey;
    const model = options.model;
    return { embed: (texts) => openaiEmbed(texts, apiKey, model) };
  }

  throw new EmbeddingConfigurationError(`Unrecognized EMBEDDING_PROVIDER: ${JSON.stringify(provider)}`);
}
