/**
 * M8: splits one knowledge_entries.content string into ordered, embeddable
 * chunks -- pure logic, no I/O, no provider dependency (chunking must work
 * identically whether or not an embedding provider is even configured, per
 * the M8 graceful-degradation design). Paragraph boundaries are preferred
 * (a paragraph is usually one coherent idea); a paragraph longer than
 * maxChunkLength is further split on sentence boundaries so no chunk grows
 * unbounded; a single "sentence" longer than maxChunkLength (no punctuation
 * at all) is hard-split as a last resort so this function always returns
 * chunks within the requested bound. Deliberately not NLP-grade sentence
 * detection (no abbreviation/decimal-aware splitting) -- correctness at
 * that level isn't needed for retrieval chunking, only "close enough"
 * boundaries, and adding an NLP dependency for this would contradict the
 * project's established no-unnecessary-dependency precedent (see M7's
 * hand-rolled Twilio signature/credential verification).
 */
export const DEFAULT_MAX_CHUNK_LENGTH = 800;

export function chunkKnowledgeContent(
  content: string,
  maxChunkLength: number = DEFAULT_MAX_CHUNK_LENGTH,
): string[] {
  if (!Number.isInteger(maxChunkLength) || maxChunkLength <= 0) {
    throw new Error(
      `maxChunkLength must be a positive integer, got ${String(maxChunkLength)}.`,
    );
  }

  const trimmed = content.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChunkLength) {
      chunks.push(paragraph);
      continue;
    }

    const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
    let current = "";

    for (const sentence of sentences) {
      if (sentence.length > maxChunkLength) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        for (let i = 0; i < sentence.length; i += maxChunkLength) {
          chunks.push(sentence.slice(i, i + maxChunkLength));
        }
        continue;
      }

      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > maxChunkLength) {
        chunks.push(current);
        current = sentence;
      } else {
        current = candidate;
      }
    }

    if (current) chunks.push(current);
  }

  return chunks;
}
