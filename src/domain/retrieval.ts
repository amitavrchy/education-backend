import type { Citation, Question, SourcePassage, TutorContext } from '../contracts/index.js';

/**
 * Data retrieval for the AI features: picks the textbook passages and bank questions that the AI
 * service is grounded on. Search only — every answer, explanation and score is written by the
 * AI service (`education-ai`).
 */

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFC');

/** Keyword search over knowledge-base passages, boosted by the conversation's topic/chapter. */
export function retrieve(query: string, context: TutorContext, passages: SourcePassage[]) {
  const q = norm(query);
  const tokens = q.split(/[\s,.?!।;:()"'“”]+/).filter((t) => t.length > 1);
  return passages
    .map((p) => {
      let score = 0;
      for (const k of p.keywords) if (k && q.includes(norm(k))) score += 3;
      const text = norm(p.text);
      for (const t of tokens) if (t.length > 2 && text.includes(t)) score += 1;
      if (score > 0) {
        if (context.topicId && p.topicId === context.topicId) score += 5;
        if (context.chapterId && p.chapterId === context.chapterId) score += 4;
        if (context.subjectId && p.subjectId === context.subjectId) score += 2;
        if (p.curriculumVersionId !== context.curriculumVersionId) score -= 2;
      }
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
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
