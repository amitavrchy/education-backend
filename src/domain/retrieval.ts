import type { Citation, Question, SourcePassage, TutorContext } from '../contracts/index.js';

/**
 * Data retrieval for the AI features: picks the textbook passages and bank questions that the AI
 * service is grounded on. Search only — every answer, explanation and score is written by the
 * AI service (`education-ai`).
 */

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFC');

/** Cosine similarity of two vectors (0 when either is empty or the lengths differ). */
export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Semantic similarity above this counts as a match (Gemini embeddings, 384 dimensions). */
const SEMANTIC_FLOOR = 0.55;

export interface Semantic {
  query: number[];
  vectors: Map<string, number[]>;
}

/**
 * Hybrid search over knowledge-base passages: keyword matches plus embedding similarity (when the
 * passages have vectors), boosted by the conversation's topic/chapter.
 */
export function retrieve(
  query: string,
  context: TutorContext,
  passages: SourcePassage[],
  semantic?: Semantic | null,
  limit = 4,
) {
  const q = norm(query);
  const tokens = q.split(/[\s,.?!।;:()"'“”]+/).filter((t) => t.length > 1);
  return passages
    .map((p) => {
      let score = 0;
      for (const k of p.keywords ?? []) if (k && q.includes(norm(k))) score += 3;
      const text = norm(p.text);
      for (const t of tokens) if (t.length > 2 && text.includes(t)) score += 1;
      const vec = semantic?.vectors.get(p.id);
      if (vec && semantic) {
        const sim = cosine(semantic.query, vec);
        if (sim > SEMANTIC_FLOOR) score += (sim - SEMANTIC_FLOOR) * 40;
      }
      if (score > 0) {
        if (context.topicId && p.topicId === context.topicId) score += 5;
        if (context.chapterId && p.chapterId === context.chapterId) score += 4;
        if (context.subjectId && p.subjectId === context.subjectId) score += 2;
        if (p.curriculumVersionId !== context.curriculumVersionId) score -= 2;
      }
      return { p, score: Math.round(score * 10) / 10 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Passages of one chapter/topic (for generated notes, flashcards and audio lessons). */
export function passagesFor(
  passages: SourcePassage[],
  where: { chapterId?: string; topicId?: string },
  limit = 6,
) {
  return passages
    .filter(
      (p) =>
        (where.topicId && p.topicId === where.topicId) ||
        (where.chapterId && p.chapterId === where.chapterId),
    )
    .slice(0, limit);
}

export function citation(p: SourcePassage, score: number): Citation {
  return {
    id: `cit-${p.id}`,
    passageId: p.id,
    bookTitle: p.bookTitle,
    chapterTitle: p.chapterTitle,
    page: p.page,
    excerpt: p.text,
    highlight: p.text.split(':')[0],
    curriculumVersionId: p.curriculumVersionId,
    verification: p.verification,
    score: Math.min(1, score / 14),
  };
}

/** Bank questions on the same topic/chapter as the answer (practice suggestions). */
export function relatedQuestions(
  questions: Question[],
  context: TutorContext,
  passages: SourcePassage[],
) {
  const topics = new Set([context.topicId, ...passages.map((p) => p.topicId)].filter(Boolean));
  const chapters = new Set(
    [context.chapterId, ...passages.map((p) => p.chapterId)].filter(Boolean),
  );
  return questions
    .filter((q) => topics.has(q.topicId) || chapters.has(q.chapterId))
    .slice(0, 3)
    .map((q) => q.id);
}

/** Title for a new conversation from its first question. */
export function titleFrom(query: string): string {
  const clean = query.replace(/[#*$\\`>\n]+/g, ' ').trim();
  return clean.length > 48 ? `${clean.slice(0, 46)}…` : clean || 'নতুন কথোপকথন';
}

/** Word groups for server-sent streaming of a finished answer. */
export function streamChunks(text: string): string[] {
  const parts = text.split(/(\s+)/);
  const chunks: string[] = [];
  for (let i = 0; i < parts.length; i += 3) chunks.push(parts.slice(i, i + 3).join(''));
  return chunks;
}
