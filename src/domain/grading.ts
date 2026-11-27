/**
 * Grading and exam scoring — ported verbatim in behaviour from the frontend
 * (services/question.service.ts gradeObjective/isAnswered/estimateWritten/filterQuestions and
 * services/exam.service.ts scoreAttempt). On the server these are authoritative: the client's
 * own scoring is only a preview.
 */
import type {
  AttemptAnswer,
  Exam,
  ExamAttempt,
  ExamResult,
  QuestionResult,
} from '../contracts/assessment.js';
import type { Difficulty } from '../contracts/common.js';
import type { Question } from '../contracts/question.js';

const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** Deterministic grading for objective types. Returns null for subjective types. */
export function gradeObjective(q: Question, a: AttemptAnswer | undefined): boolean | null {
  switch (q.type) {
    case 'mcq':
      return !!a?.optionId && a.optionId === q.correctOptionId;
    case 'true_false':
      return a?.booleanValue !== undefined && a.booleanValue === q.correctBoolean;
    case 'fill_blank':
      return (
        !!q.blanks?.length &&
        q.blanks.every((accepted, i) =>
          accepted.some((x) => norm(x) === norm(a?.blanks?.[i] ?? '')),
        )
      );
    case 'matching':
      return (
        !!q.matchingPairs?.length && q.matchingPairs.every((p) => a?.matches?.[p.left] === p.right)
      );
    case 'numerical':
      if (!q.numericAnswer || a?.numeric === undefined || Number.isNaN(a.numeric))
        return a?.optionId ? a.optionId === q.correctOptionId : false;
      return Math.abs(a.numeric - q.numericAnswer.value) <= q.numericAnswer.tolerance;
    default:
      if (q.options?.length && q.correctOptionId) return a?.optionId === q.correctOptionId;
      return null;
  }
}

export function isAnswered(_q: Question, a: AttemptAnswer | undefined): boolean {
  if (!a) return false;
  return !!(
    a.optionId ||
    a.booleanValue !== undefined ||
    a.text?.trim() ||
    a.blanks?.some((b) => b.trim()) ||
    (a.matches && Object.keys(a.matches).length) ||
    (a.numeric !== undefined && !Number.isNaN(a.numeric)) ||
    a.uploadNames?.length
  );
}

/**
 * Explicitly non-authoritative estimate for written answers: keyword overlap with the model
 * answer, scaled to the marks. Teachers decide the final mark.
 */
export function estimateWritten(q: Question, text: string): { marks: number; feedback: string } {
  const words = (s: string) =>
    new Set(
      norm(s.replace(/[$\\{}^_().,;:।?!*]/g, ' '))
        .split(' ')
        .filter((w) => w.length > 2),
    );
  const model = words(q.answer + ' ' + (q.cqParts?.map((p) => p.answer).join(' ') ?? ''));
  const mine = words(text);
  if (!mine.size) return { marks: 0, feedback: 'উত্তর খালি।' };
  let hit = 0;
  for (const w of model) if (mine.has(w)) hit++;
  const ratio = Math.min(1, hit / Math.max(4, model.size * 0.6));
  const lengthBonus = Math.min(0.15, text.length / 4000);
  const marks = Math.round(Math.min(1, ratio + lengthBonus) * q.marks * 2) / 2;
  return {
    marks,
    feedback:
      ratio > 0.7
        ? 'মূল ধারণাগুলো এসেছে। উপস্থাপনা আরও গোছালো করো।'
        : ratio > 0.35
          ? 'কিছু গুরুত্বপূর্ণ পয়েন্ট বাদ পড়েছে — মডেল উত্তরের সাথে মিলিয়ে দেখো।'
          : 'উত্তরে মূল ধারণাগুলো অনুপস্থিত। অধ্যায়টি আবার পড়ো।',
  };
}

export interface QuestionFilters {
  levelCode?: string;
  subjectId?: string;
  chapterIds?: string[];
  topicIds?: string[];
  types?: string[];
  difficulty?: string[];
}

export function filterQuestions(items: Question[], f: QuestionFilters): Question[] {
  return items.filter(
    (q) =>
      q.status === 'published' &&
      (!f.levelCode || q.levelCode === f.levelCode) &&
      (!f.subjectId || q.subjectId === f.subjectId) &&
      (!f.chapterIds?.length || f.chapterIds.includes(q.chapterId)) &&
      (!f.topicIds?.length || (!!q.topicId && f.topicIds.includes(q.topicId))) &&
      (!f.types?.length || f.types.includes(q.type)) &&
      (!f.difficulty?.length || f.difficulty.includes(q.difficulty)),
  );
}

const GRADES: [number, string][] = [
  [80, 'A+'],
  [70, 'A'],
  [60, 'A-'],
  [50, 'B'],
  [40, 'C'],
  [33, 'D'],
  [0, 'F'],
];
export const gradeFor = (percent: number) => GRADES.find(([min]) => percent >= min)![1];

export function scoreAttempt(
  exam: Pick<Exam, 'negativeMarking' | 'passPercent' | 'totalMarks'>,
  questions: Question[],
  attempt: Pick<ExamAttempt, 'answers' | 'timePerQuestion' | 'questionOrder' | 'startedAt'>,
  submittedAt = new Date().toISOString(),
  /** AI examiner marks for written answers (raw, out of the question's marks), by question id. */
  written?: Map<string, { marks: number; feedback: string }>,
): ExamResult {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ordered = attempt.questionOrder.map((id) => byId.get(id)).filter((q): q is Question => !!q);
  const rawTotal = ordered.reduce((s, q) => s + q.marks, 0) || 1;
  const scale = exam.totalMarks / rawTotal;
  let negative = 0;
  const results: QuestionResult[] = ordered.map((q) => {
    const a: AttemptAnswer | undefined = attempt.answers[q.id];
    const max = +(q.marks * scale).toFixed(2);
    const base = {
      questionId: q.id,
      type: q.type,
      topicId: q.topicId,
      chapterId: q.chapterId,
      difficulty: q.difficulty,
      max,
      timeSpentSec: attempt.timePerQuestion[q.id],
    };
    if (!isAnswered(q, a)) return { ...base, status: 'unanswered' as const, awarded: 0 };
    const objective = gradeObjective(q, a);
    if (objective === true) return { ...base, status: 'correct' as const, awarded: max };
    if (objective === false) {
      negative += exam.negativeMarking;
      return { ...base, status: 'incorrect' as const, awarded: 0 };
    }
    const ai = written?.get(q.id);
    const est = ai ?? estimateWritten(q, a?.text ?? '');
    const by = ai ? ('ai' as const) : ('estimate' as const);
    return {
      ...base,
      status: 'pending_review' as const,
      awarded: +(est.marks * scale).toFixed(2),
      aiEstimate: { marks: +(est.marks * scale).toFixed(2), feedback: est.feedback, by },
    };
  });
  const score = Math.max(0, +(results.reduce((s, r) => s + r.awarded, 0) - negative).toFixed(2));
  const correct = results.filter((r) => r.status === 'correct').length;
  const incorrect = results.filter((r) => r.status === 'incorrect').length;
  const unanswered = results.filter((r) => r.status === 'unanswered').length;
  const pendingReview = results.filter((r) => r.status === 'pending_review').length;
  const percent = Math.round((score / exam.totalMarks) * 100);
  const byTopicMap = new Map<
    string,
    { topicId: string; chapterId: string; correct: number; total: number }
  >();
  for (const r of results) {
    const key = r.topicId ?? r.chapterId;
    const e = byTopicMap.get(key) ?? { topicId: key, chapterId: r.chapterId, correct: 0, total: 0 };
    e.total += 1;
    if (r.status === 'correct' || (r.status === 'pending_review' && r.awarded >= r.max * 0.6))
      e.correct += 1;
    byTopicMap.set(key, e);
  }
  const byTopic = [...byTopicMap.values()];
  const byDifficulty = (['easy', 'medium', 'hard'] as Difficulty[]).reduce(
    (acc, d) => {
      const list = results.filter((r) => r.difficulty === d);
      acc[d] = { correct: list.filter((r) => r.status === 'correct').length, total: list.length };
      return acc;
    },
    {} as ExamResult['byDifficulty'],
  );
  const weakTopicIds = byTopic
    .filter((t) => t.total > 0 && t.correct / t.total < 0.6)
    .map((t) => t.topicId);
  const objectiveAnswered = correct + incorrect;
  return {
    score,
    total: exam.totalMarks,
    percent,
    correct,
    incorrect,
    unanswered,
    pendingReview,
    accuracy: objectiveAnswered ? Math.round((correct / objectiveAnswered) * 100) : 0,
    timeSpentSec: Math.round(
      (new Date(submittedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000,
    ),
    negativeDeducted: +negative.toFixed(2),
    passed: percent >= exam.passPercent,
    grade: gradeFor(percent),
    questions: results,
    byTopic,
    byDifficulty,
    weakTopicIds,
    recommendedChapterIds: [
      ...new Set(byTopic.filter((t) => weakTopicIds.includes(t.topicId)).map((t) => t.chapterId)),
    ],
    containsSimulatedGrading: results.some((r) => r.aiEstimate?.by === 'estimate'),
    aiGraded: results.some((r) => r.aiEstimate?.by === 'ai'),
  };
}

/** Seeded shuffle (mulberry32) so the same seed gives the same order. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let t = h >>> 0;
  const rand = () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
