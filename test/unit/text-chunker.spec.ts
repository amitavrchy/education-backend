import { chunkText } from '../../src/modules/document-processing/text-chunker.js';

describe('chunkText', () => {
  it('keeps short text as one chunk', () => {
    expect(chunkText('নিউটনের প্রথম সূত্র। বস্তু স্থির থাকে।')).toEqual([
      'নিউটনের প্রথম সূত্র। বস্তু স্থির থাকে।',
    ]);
  });

  it('splits long text on sentence boundaries, including the Bangla dari, within the size limit', () => {
    const sentence = 'এটি একটি পরীক্ষামূলক বাক্য।';
    const chunks = chunkText(Array.from({ length: 50 }, () => sentence).join(' '), {
      maxChars: 200,
      overlapChars: 20,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
  });

  it('hard-splits a single sentence longer than the limit', () => {
    const chunks = chunkText('a'.repeat(500), { maxChars: 100, overlapChars: 10 });
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
  });
});
