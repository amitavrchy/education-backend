import { Injectable } from '@nestjs/common';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { dateKey, nowIso } from '../../common/utils/dates.js';
import type { AttemptAnswer, Exam, ExamAttempt, ExamKind } from '../../contracts/assessment.js';
import type { Difficulty } from '../../contracts/common.js';
import type { Subject } from '../../contracts/curriculum.js';
import type { Question, QuestionType } from '../../contracts/question.js';
import type { TopicMastery } from '../../contracts/study.js';
import { OBJECTIVE_TYPES } from '../../contracts/question.js';
import { filterQuestions, scoreAttempt, seededShuffle } from '../../domain/grading.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProgressService } from '../progress/progress.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';
import { resourceByCollection } from '../records/resource-registry.js';
import { ResourcesService } from '../records/resources.service.js';

const EXAMS = { collection: 'exams', scope: '' };
const QUESTIONS = { collection: 'questions', scope: '' };
/** Network grace before a timed attempt is considered over. */
const GRACE_MS = 60_000;

const DEFAULT_INSTRUCTIONS = [
  'প্রতিটি প্রশ্নের উত্তর দিতে প্রশ্ন প্যালেট ব্যবহার করে যেকোনো প্রশ্নে যাওয়া যাবে।',
  'উত্তর স্বয়ংক্রিয়ভাবে সংরক্ষিত হয়। ইন্টারনেট বিচ্ছিন্ন হলেও পরে আবার চালিয়ে যেতে পারবে।',
  'সময় শেষ হলে পরীক্ষা স্বয়ংক্রিয়ভাবে জমা হবে।',
  'লিখিত উত্তরের AI মূল্যায়ন একটি সিমুলেটেড অনুমান — চূড়ান্ত নম্বর শিক্ষক নির্ধারণ করবেন।',
];

const KIND_TITLES: Partial<Record<ExamKind, string>> = {
  chapter: 'অধ্যায়ভিত্তিক পরীক্ষা',
  topic: 'টপিকভিত্তিক পরীক্ষা',
  subject: 'বিষয়ভিত্তিক পরীক্ষা',
  full_syllabus: 'পূর্ণ সিলেবাস পরীক্ষা',
  adaptive: 'অ্যাডাপটিভ পরীক্ষা',
  custom: 'কাস্টম পরীক্ষা',
  mixed: 'মিশ্র অনুশীলন',
  daily_challenge: 'দৈনিক চ্যালেঞ্জ',
};

export interface ExamSetup {
  kind: ExamKind;
  title?: string;
  subjectId?: string;
  chapterIds: string[];
  topicIds: string[];
  types: QuestionType[];
  count: number;
  difficulty: Difficulty | 'mixed';
  durationMinutes: number;
  negativeMarking: number;
  mode: 'practice' | 'exam';
  randomize: boolean;
  reviewPolicy: Exam['reviewPolicy'];
  levelCode?: 'SSC' | 'HSC';
}

export type AttemptPatch = Partial<
  Pick<ExamAttempt, 'answers' | 'markedForReview' | 'currentIndex' | 'timePerQuestion'>
> & { remainingSec?: number };

/** Strips everything that would reveal an answer (used while an attempt is in progress). */
export function sanitizeQuestion(q: Question): Partial<Question> {
  const {
    answer: _a,
    explanation: _e,
    correctOptionId: _c,
    correctBoolean: _b,
    blanks,
    numericAnswer: _n,
    matchingPairs,
    steps: _s,
    rubric: _r,
    cqParts,
    ...rest
  } = q;
  return {
    ...rest,
    blanks: blanks?.map(() => []),
    // Keep both sides of matching items, but shuffled so pairs aren't given away.
    matchingPairs: matchingPairs
      ? matchingPairs.map((p, i, all) => ({ left: p.left, right: all[(i + 1) % all.length].right }))
      : undefined,
    cqParts: cqParts?.map((p) => ({ ...p, answer: '' })),
  };
}

function baseExam(p: Partial<Exam> & Pick<Exam, 'id' | 'title' | 'kind'>): Exam {
  const now = nowIso();
  return {
    levelCode: 'SSC',
    chapterIds: [],
    topicIds: [],
    questionIds: [],
    questionTypes: ['mcq'],
    difficulty: 'mixed',
    durationMinutes: 30,
    totalMarks: 30,
    negativeMarking: 0,
    mode: 'exam',
    randomize: true,
    reviewPolicy: 'after_submit',
    status: 'published',
    createdBy: { id: 'system', name: 'ShikkhaAI', role: 'system' },
    instructions: DEFAULT_INSTRUCTIONS,
    passPercent: 40,
    resultsPublished: true,
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

/**
 * Exam engine: attempt lifecycle with server-side timing and scoring (frontend examService).
 * The client's timer is a display; the server decides when an attempt has expired.
 */
@Injectable()
export class ExamsService {
  constructor(
    private readonly store: RecordStoreService,
    private readonly resources: ResourcesService,
    private readonly progress: ProgressService,
    private readonly notifications: NotificationsService,
  ) {}

  private attemptsRef(studentId: string) {
    return { collection: 'examAttempts', scope: studentId };
  }

  /** The exam as this caller may see it (same visibility rules as GET /exams/:id). */
  private visibleExam(user: AuthenticatedUser, examId: string): Promise<Exam> {
    return this.resources.get(
      resourceByCollection('exams')!,
      user,
      '',
      examId,
    ) as unknown as Promise<Exam>;
  }

  private async pickQuestions(
    setup: Pick<
      ExamSetup,
      'subjectId' | 'chapterIds' | 'topicIds' | 'types' | 'difficulty' | 'levelCode'
    >,
    count: number,
    seed: string,
    preferTopicIds?: string[],
  ): Promise<Question[]> {
    const filters = {
      status: ['published'],
      ...(setup.subjectId
        ? { subjectId: [setup.subjectId] }
        : setup.levelCode
          ? { levelCode: [setup.levelCode] }
          : {}),
    };
    const all = await this.store.all<Question & Entity>(QUESTIONS, 'all', { filters });
    const pool = filterQuestions(all, {
      types: setup.types.length ? setup.types : undefined,
      difficulty: setup.difficulty === 'mixed' ? undefined : [setup.difficulty],
      chapterIds: setup.chapterIds,
      topicIds: setup.topicIds,
    });
    if (preferTopicIds?.length) {
      const weak = seededShuffle(
        pool.filter((q) => q.topicId && preferTopicIds.includes(q.topicId)),
        seed,
      );
      const rest = seededShuffle(
        pool.filter((q) => !weak.includes(q)),
        seed + 'r',
      );
      return [...weak, ...rest].slice(0, count);
    }
    // Interleave by type so mixed exams aren't dominated by one type.
    const byType = new Map<string, Question[]>();
    for (const q of seededShuffle(pool, seed))
      byType.set(q.type, [...(byType.get(q.type) ?? []), q]);
    const out: Question[] = [];
    while (out.length < count && [...byType.values()].some((l) => l.length))
      for (const list of byType.values())
        if (list.length && out.length < count) out.push(list.shift()!);
    return out;
  }

  // ── Starting ───────────────────────────────────────────────────────────

  async createAndStart(user: AuthenticatedUser, setup: ExamSetup): Promise<string> {
    let prefer: string[] | undefined;
    if (setup.kind === 'adaptive') {
      const mastery = await this.store.all<TopicMastery & Entity>({
        collection: 'mastery',
        scope: user.id,
      });
      prefer = mastery
        .filter((m) => !setup.subjectId || m.subjectId === setup.subjectId)
        .sort((a, b) => a.mastery - b.mastery)
        .slice(0, 6)
        .map((m) => m.topicId);
    }
    const picked = await this.pickQuestions(setup, setup.count, `${user.id}-${Date.now()}`, prefer);
    if (!picked.length) invalid('NO_QUESTIONS');
    const subject = setup.subjectId
      ? await this.store.find<Subject & Entity>(
          { collection: 'subjects', scope: '' },
          setup.subjectId,
        )
      : undefined;
    const exam = baseExam({
      id: RecordStoreService.newId('ex'),
      title:
        setup.title?.slice(0, 200) ||
        `${subject ? `${subject.name.bn} — ` : ''}${KIND_TITLES[setup.kind] ?? 'পরীক্ষা'}`,
      kind: setup.kind,
      levelCode: subject?.levelCode ?? setup.levelCode ?? 'SSC',
      subjectId: setup.subjectId,
      chapterIds: setup.chapterIds,
      topicIds: setup.topicIds,
      questionIds: picked.map((q) => q.id),
      questionTypes: setup.types,
      difficulty: setup.difficulty,
      durationMinutes: setup.durationMinutes,
      totalMarks: picked.reduce((s, q) => s + q.marks, 0),
      negativeMarking: setup.negativeMarking,
      mode: setup.mode,
      randomize: setup.randomize,
      reviewPolicy: setup.reviewPolicy,
      createdBy: { id: user.id, name: 'student', role: 'student' },
    });
    await this.store.insert(EXAMS, exam as Exam & Entity, { institutionField: 'institutionId' });
    return this.start(user, exam.id);
  }

  /** Same 10 questions for everyone today (seeded by the Bangladesh date). */
  async startDailyChallenge(
    user: AuthenticatedUser,
    levelCode: 'SSC' | 'HSC' = 'SSC',
  ): Promise<string> {
    const today = dateKey(0);
    const id = `ex-daily-${today}-${levelCode}`;
    if (!(await this.store.find(EXAMS, id))) {
      const picked = await this.pickQuestions(
        {
          chapterIds: [],
          topicIds: [],
          types: ['mcq', 'true_false'],
          difficulty: 'mixed',
          levelCode,
        },
        10,
        `daily-${today}`,
      );
      if (!picked.length) invalid('NO_QUESTIONS');
      const exam = baseExam({
        id,
        title: `দৈনিক চ্যালেঞ্জ — ${today}`,
        kind: 'daily_challenge',
        levelCode,
        questionIds: picked.map((q) => q.id),
        durationMinutes: 10,
        totalMarks: picked.length,
        questionTypes: ['mcq', 'true_false'],
        instructions: ['১০টি প্রশ্ন, ১০ মিনিট। প্রতিদিন নতুন চ্যালেঞ্জ!'],
      });
      await this.store.upsert(EXAMS, exam as Exam & Entity);
    }
    return this.start(user, id);
  }

  /** Starts (or resumes) an attempt. */
  async start(user: AuthenticatedUser, examId: string): Promise<string> {
    const studentId = user.id;
    const ref = this.attemptsRef(studentId);
    const existing = await this.store.all<ExamAttempt & Entity>(ref, [
      { examId: [examId], status: ['in_progress'] },
    ]);
    if (existing[0]) return existing[0].id;
    const exam = await this.visibleExam(user, examId);
    const now = Date.now();
    if (exam.status === 'draft' || exam.status === 'archived' || exam.status === 'closed')
      invalid('EXAM_NOT_AVAILABLE', undefined, 409);
    if (
      exam.scheduledAt &&
      new Date(exam.scheduledAt).getTime() > now &&
      exam.kind === 'institution'
    )
      invalid('EXAM_NOT_OPEN', undefined, 409);
    if (exam.closesAt && new Date(exam.closesAt).getTime() < now)
      invalid('EXAM_CLOSED', undefined, 409);
    let ids = exam.questionIds;
    if (!ids.length) {
      // Catalogue exams pick their questions at attempt time from their chapter scope.
      const picked = await this.pickQuestions(
        {
          subjectId: exam.subjectId,
          chapterIds: exam.chapterIds,
          topicIds: exam.topicIds,
          types: exam.questionTypes,
          difficulty: exam.difficulty,
          levelCode: exam.levelCode,
        },
        Math.max(5, Math.min(25, Math.round(exam.totalMarks / 1.2))),
        `${examId}-${studentId}`,
      );
      if (!picked.length) invalid('NO_QUESTIONS');
      ids = picked.map((q) => q.id);
    }
    const order = exam.randomize ? seededShuffle(ids, `${examId}-${now}`) : ids;
    const stamp = nowIso();
    const attempt: ExamAttempt = {
      id: RecordStoreService.newId('att'),
      examId,
      examTitle: exam.title,
      studentId,
      questionOrder: order,
      startedAt: stamp,
      status: 'in_progress',
      answers: {},
      markedForReview: [],
      currentIndex: 0,
      remainingSec: exam.durationMinutes * 60,
      lastSavedAt: stamp,
      timePerQuestion: {},
    };
    await this.store.insert(ref, attempt as ExamAttempt & Entity);
    return attempt.id;
  }

  // ── In progress ────────────────────────────────────────────────────────

  private async attempt(studentId: string, attemptId: string): Promise<ExamAttempt & Entity> {
    return (
      (await this.store.find<ExamAttempt & Entity>(this.attemptsRef(studentId), attemptId)) ??
      notFound('ExamAttempt')
    );
  }

  private deadline(exam: Exam, attempt: ExamAttempt): number {
    const byDuration = new Date(attempt.startedAt).getTime() + exam.durationMinutes * 60_000;
    const byClose = exam.closesAt ? new Date(exam.closesAt).getTime() : Infinity;
    return Math.min(byDuration, byClose);
  }

  /** Questions for an attempt; answers are hidden until it is submitted. */
  async attemptQuestions(studentId: string, attemptId: string) {
    const attempt = await this.attempt(studentId, attemptId);
    const questions = await this.store.findMany<Question & Entity>(
      QUESTIONS,
      attempt.questionOrder,
    );
    return attempt.status === 'in_progress' ? questions.map(sanitizeQuestion) : questions;
  }

  /** Autosave. The server computes remaining time; an expired attempt is submitted instead. */
  async save(studentId: string, attemptId: string, patch: AttemptPatch): Promise<ExamAttempt> {
    const attempt = await this.attempt(studentId, attemptId);
    if (attempt.status !== 'in_progress') return attempt;
    const exam = (await this.store.find<Exam & Entity>(EXAMS, attempt.examId)) ?? notFound('Exam');
    const deadline = this.deadline(exam, attempt);
    if (Date.now() > deadline + GRACE_MS)
      return this.submit(studentId, attemptId, 'time_expired', patch.answers);
    const allowed = new Set(attempt.questionOrder);
    const answers = patch.answers
      ? Object.fromEntries(Object.entries(patch.answers).filter(([id]) => allowed.has(id)))
      : attempt.answers;
    const next: ExamAttempt = {
      ...attempt,
      answers,
      markedForReview:
        patch.markedForReview?.filter((id) => allowed.has(id)) ?? attempt.markedForReview,
      currentIndex: Math.max(
        0,
        Math.min(attempt.questionOrder.length - 1, patch.currentIndex ?? attempt.currentIndex),
      ),
      timePerQuestion: patch.timePerQuestion
        ? Object.fromEntries(
            Object.entries(patch.timePerQuestion).filter(([id]) => allowed.has(id)),
          )
        : attempt.timePerQuestion,
      remainingSec: Math.max(0, Math.round((deadline - Date.now()) / 1000)),
      lastSavedAt: nowIso(),
    };
    return this.store.replace(this.attemptsRef(studentId), next as ExamAttempt & Entity);
  }

  async submit(
    studentId: string,
    attemptId: string,
    reason: 'manual' | 'time_expired' = 'manual',
    finalAnswers?: Record<string, AttemptAnswer>,
  ): Promise<ExamAttempt> {
    const attempt = await this.attempt(studentId, attemptId);
    if (attempt.status !== 'in_progress') return attempt;
    const exam = (await this.store.find<Exam & Entity>(EXAMS, attempt.examId)) ?? notFound('Exam');
    const late = Date.now() > this.deadline(exam, attempt) + GRACE_MS;
    // Answers arriving after the deadline (+ grace) are not accepted.
    const allowed = new Set(attempt.questionOrder);
    const answers =
      finalAnswers && !late
        ? {
            ...attempt.answers,
            ...Object.fromEntries(Object.entries(finalAnswers).filter(([id]) => allowed.has(id))),
          }
        : attempt.answers;
    const questions = await this.store.findMany<Question & Entity>(
      QUESTIONS,
      attempt.questionOrder,
    );
    const submittedAt = nowIso();
    const totalMarks = exam.questionIds.length
      ? exam.totalMarks
      : questions.reduce((s, q) => s + q.marks, 0);
    const result = scoreAttempt(
      { ...exam, totalMarks },
      questions,
      { ...attempt, answers },
      submittedAt,
    );
    const status = reason === 'time_expired' || late ? 'expired' : 'submitted';
    const updated: ExamAttempt = {
      ...attempt,
      answers,
      status,
      submittedAt,
      result,
      remainingSec: 0,
      lastSavedAt: submittedAt,
    };
    await this.store.replace(this.attemptsRef(studentId), updated as ExamAttempt & Entity);

    const counted = result.questions.filter(
      (r) =>
        r.status === 'correct' ||
        r.status === 'incorrect' ||
        (r.status === 'pending_review' && !OBJECTIVE_TYPES.includes(r.type)),
    );
    await this.progress.recordAttempts(
      studentId,
      counted.map((r) => ({
        questionId: r.questionId,
        source: 'exam' as const,
        timeSpentSec: r.timeSpentSec,
      })),
      {
        minutes: Math.max(1, Math.round(result.timeSpentSec / 60)),
        label: exam.title,
        trusted: counted.map((r) => ({
          correct:
            r.status === 'correct' || (r.status === 'pending_review' && r.awarded >= r.max * 0.6),
        })),
      },
    );
    if (result.percent === 100) await this.progress.grantBadge(studentId, 'exam-perfect');
    await this.notifications.push([studentId], {
      portal: 'student',
      type: 'exam_result',
      title: `ফলাফল: ${exam.title}`,
      body: `${result.score}/${result.total} (${result.percent}%) · গ্রেড ${result.grade}`,
      href: `/student/exams/results/${attemptId}`,
      priority: 'normal',
    });
    return updated;
  }

  async discard(studentId: string, attemptId: string): Promise<void> {
    const attempt = await this.attempt(studentId, attemptId);
    if (attempt.status !== 'in_progress') invalid('ATTEMPT_ALREADY_SUBMITTED', undefined, 409);
    await this.store.remove(this.attemptsRef(studentId), [attemptId]);
  }
}
