/**
 * Splits extracted text into overlapping chunks for embedding.
 * Splits on paragraph and sentence boundaries, including the Bangla dari (।).
 */
export function chunkText(
  text: string,
  options: { maxChars?: number; overlapChars?: number } = {},
): string[] {
  const maxChars = options.maxChars ?? 1_200;
  const overlap = Math.min(options.overlapChars ?? 150, Math.floor(maxChars / 2));
  const sentences = text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?।])\s+|\n{2,}/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxChars) {
      chunks.push(current);
      current = current.slice(-overlap);
    }
    current = current ? `${current} ${sentence}` : sentence;
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars));
      current = current.slice(maxChars - overlap);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
