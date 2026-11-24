import type { ExamAttempt } from '../../src/contracts/assessment.js';
import type { Question } from '../../src/contracts/question.js';
import {
  estimateWritten,
  gradeFor,
  gradeObjective,
  scoreAttempt,
  seededShuffle,
} from '../../src/domain/grading.js';

const q = (p: Partial<Question>): Question =>
  ({
    id: 'q',
    type: 'mcq',
    stem: 's',
    answer: 'বল ভর ত্বরণ',
    explanation: '',
    marks: 1,
    difficulty: 'easy',
    chapterId: 'c1',
    topicId: 't1',
    subjectId: 's1',
    levelCode: 'SSC',
    status: 'published',
    tags: [],
    ...p,
  }) as Question;

const attempt = (
  answers: ExamAttempt['answers'],
  order: string[],
): Pick<ExamAttempt, 'answers' | 'timePerQuestion' | 'questionOrder' | 'startedAt'> => ({
  answers,
  timePerQuestion: {},
  questionOrder: order,
  startedAt: new Date(Date.now() - 60_000).toISOString(),
});

describe('gradeObjective', () => {
  it('grades each objective type', () => {
    expect(gradeObjective(q({ correctOptionId: 'b' }), { optionId: 'b' })).toBe(true);
    expect(gradeObjective(q({ correctOptionId: 'b' }), { optionId: 'a' })).toBe(false);
    expect(
      gradeObjective(q({ type: 'true_false', correctBoolean: false }), { booleanValue: false }),
    ).toBe(true);
    expect(
      gradeObjective(q({ type: 'fill_blank', blanks: [['Newton', 'নিউটন']] }), {
        blanks: ['  newton '],
      }),
    ).toBe(true);
    expect(
      gradeObjective(q({ type: 'matching', matchingPairs: [{ left: 'a', right: '1' }] }), {
        matches: { a: '1' },
      }),
    ).toBe(true);
    expect(
      gradeObjective(q({ type: 'numerical', numericAnswer: { value: 9.8, tolerance: 0.1 } }), {
        numeric: 9.75,
      }),
    ).toBe(true);
    expect(
      gradeObjective(q({ type: 'numerical', numericAnswer: { value: 9.8, tolerance: 0.1 } }), {
        numeric: 10,
      }),
    ).toBe(false);
  });

  it('returns null for subjective types', () => {
    expect(gradeObjective(q({ type: 'creative' }), { text: 'x' })).toBeNull();
  });
});

describe('scoreAttempt', () => {
  const questions = [
    q({ id: 'a', correctOptionId: 'x', marks: 1 }),
    q({ id: 'b', correctOptionId: 'x', marks: 1, difficulty: 'hard', topicId: 't2' }),
    q({ id: 'c', correctOptionId: 'x', marks: 2, topicId: 't3' }),
  ];

  it('scales to total marks, applies negative marking and grades', () => {
    const r = scoreAttempt(
      { totalMarks: 8, negativeMarking: 0.5, passPercent: 40 },
      questions,
      attempt({ a: { optionId: 'x' }, b: { optionId: 'y' } }, ['a', 'b', 'c']),
    );
    expect(r.correct).toBe(1);
    expect(r.incorrect).toBe(1);
    expect(r.unanswered).toBe(1);
    expect(r.score).toBe(1.5); // 1 × (8/4) − 0.5
    expect(r.percent).toBe(19);
    expect(r.passed).toBe(false);
    expect(r.grade).toBe('F');
    expect(r.weakTopicIds).toEqual(['t2', 't3']);
    expect(r.byDifficulty.hard).toEqual({ correct: 0, total: 1 });
  });

  it('never goes below zero', () => {
    const r = scoreAttempt(
      { totalMarks: 4, negativeMarking: 2, passPercent: 40 },
      questions,
      attempt({ a: { optionId: 'n' }, b: { optionId: 'n' } }, ['a', 'b', 'c']),
    );
    expect(r.score).toBe(0);
  });

  it('ignores answers to questions outside the attempt order', () => {
    const r = scoreAttempt(
      { totalMarks: 1, negativeMarking: 0, passPercent: 40 },
      questions,
      attempt({ b: { optionId: 'x' } }, ['a']),
    );
    expect(r.correct).toBe(0);
    expect(r.questions).toHaveLength(1);
  });

  it('flags written answers as simulated, pending review', () => {
    const r = scoreAttempt(
      { totalMarks: 2, negativeMarking: 0, passPercent: 40 },
      [q({ id: 'w', type: 'short', marks: 2 })],
      attempt({ w: { text: 'বল ভর ত্বরণ সম্পর্ক' } }, ['w']),
    );
    expect(r.pendingReview).toBe(1);
    expect(r.containsSimulatedGrading).toBe(true);
  });
});

describe('helpers', () => {
  it('maps percent to Bangladesh grades', () => {
    expect([
      gradeFor(85),
      gradeFor(72),
      gradeFor(65),
      gradeFor(55),
      gradeFor(45),
      gradeFor(35),
      gradeFor(10),
    ]).toEqual(['A+', 'A', 'A-', 'B', 'C', 'D', 'F']);
  });

  it('estimates empty written answers as zero', () => {
    expect(estimateWritten(q({ type: 'short', marks: 4 }), '').marks).toBe(0);
  });

  it('shuffles deterministically per seed', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(items, 'x')).toEqual(seededShuffle(items, 'x'));
    expect(seededShuffle(items, 'x').sort()).toEqual(items);
  });
});
