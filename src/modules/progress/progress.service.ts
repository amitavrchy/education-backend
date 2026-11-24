import { Injectable } from '@nestjs/common';
import { invalid } from '../../common/exceptions/app.exception.js';
import { dateKey, hourInPlatformTz, nowIso } from '../../common/utils/dates.js';
import type { ExamAttempt } from '../../contracts/assessment.js';
import type { Topic } from '../../contracts/curriculum.js';
import type { Flashcard } from '../../contracts/study.js';
import type { Question, QuestionAttempt } from '../../contracts/question.js';
import type {
  ActivityEntry,
  ChapterProgress,
  GamificationState,
  TopicMastery,
} from '../../contracts/study.js';
import {
  BADGES,
  MISSIONS,
  parseMissionId,
  updateMastery,
  weekStartKey,
} from '../../domain/progress-rules.js';
import { gradeObjective } from '../../domain/grading.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DocumentsService } from '../records/documents.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';
import type { AttemptAnswer } from '../../contracts/assessment.js';

export interface AttemptInput {
  questionId: string;
  /** When given, the server grades it; otherwise `correct` is a self-assessment. */
  answer?: AttemptAnswer;
  correct?: boolean;
  source: QuestionAttempt['source'];
  timeSpentSec?: number;
}

export type ChapterAction =
  'start' | 'complete' | 'reset' | { topicDone: string; totalTopics?: number };

const MAX_ATTEMPTS_PER_CALL = 200;

const gamKey = (id: string) => `gamification:${id}`;

export function emptyGamification(): GamificationState {
  return {
    id: 'me',
    xp: 0,
    points: 0,
    streak: { current: 0, longest: 0, freezeAvailable: 1 },
    badges: [],
    missionProgress: {},
    claimedMissions: [],
    history: [],
    friendChallenges: [],
  };
}

/**
 * Learning engine: attempts → topic mastery → chapter progress → activity/XP/streak/badges.
 * The only writer of the student's attempts, mastery, chapterProgress, activity and gamification.
 */
@Injectable()
export class ProgressService {
  constructor(
    private readonly store: RecordStoreService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
  ) {}

  private ref(collection: string, studentId: string) {
    return { collection, scope: studentId };
  }

  gamification(studentId: string): Promise<GamificationState> {
    return this.documents.get(gamKey(studentId), emptyGamification, studentId);
  }

  private saveGamification(studentId: string, g: GamificationState) {
    return this.documents.set(gamKey(studentId), g, studentId);
  }

  /** Records answers (practice, quizzes, flashcards, exams) and updates mastery. */
  async recordAttempts(
    studentId: string,
    inputs: AttemptInput[],
    opts: { minutes?: number; label?: string; trusted?: { correct: boolean }[] } = {},
  ) {
    if (!inputs.length) return { recorded: 0, xp: 0 };
    if (inputs.length > MAX_ATTEMPTS_PER_CALL) invalid('VALIDATION', { attempts: ['TOO_MANY'] });
    const questions = await this.store.findMany<Question & Entity>(
      { collection: 'questions', scope: '' },
      [...new Set(inputs.map((i) => i.questionId))],
    );
    const byId = new Map(questions.map((q) => [q.id, q]));
    const stamp = nowIso();
    const attempts: QuestionAttempt[] = [];
    inputs.forEach((input, i) => {
      const q = byId.get(input.questionId);
      if (!q) return; // unknown/removed question: ignore rather than fail the whole batch
      const graded = input.answer ? gradeObjective(q, input.answer) : null;
      const correct = opts.trusted?.[i]?.correct ?? graded ?? !!input.correct;
      attempts.push({
        id: RecordStoreService.newId('att'),
        questionId: q.id,
        subjectId: q.subjectId,
        chapterId: q.chapterId,
        topicId: q.topicId,
        correct,
        source: input.source,
        answeredAt: stamp,
        timeSpentSec: input.timeSpentSec,
      });
    });
    if (!attempts.length) return { recorded: 0, xp: 0 };
    await this.store.insertMany(
      this.ref('attempts', studentId),
      attempts as (QuestionAttempt & Entity)[],
    );

    const masteryRef = this.ref('mastery', studentId);
    const topicIds = new Set<string>();
    const topicsByChapter = new Map<string, string>();
    for (const a of attempts)
      if (!a.topicId && !topicsByChapter.has(a.chapterId)) {
        const [t] = await this.store.all<Topic & Entity>(
          { collection: 'topics', scope: '' },
          'all',
          { filters: { chapterId: [a.chapterId] }, sortBy: 'order' },
        );
        if (t) topicsByChapter.set(a.chapterId, t.id);
      }
    const existing = new Map(
      (await this.store.all<TopicMastery & Entity>(masteryRef)).map((m) => [m.id, m]),
    );
    for (const a of attempts) {
      const topicId = a.topicId ?? topicsByChapter.get(a.chapterId);
      if (!topicId) continue;
      const m = existing.get(topicId) ?? {
        id: topicId,
        topicId,
        chapterId: a.chapterId,
        subjectId: a.subjectId,
        attempts: 0,
        correct: 0,
        mastery: 50,
        trend: [],
        mistakes: {},
      };
      existing.set(topicId, updateMastery(m, a) as TopicMastery & Entity);
      topicIds.add(topicId);
    }
    for (const id of topicIds) await this.store.upsert(masteryRef, existing.get(id)!);

    const correct = attempts.filter((a) => a.correct).length;
    const minutes =
      opts.minutes ??
      Math.max(1, Math.round(attempts.reduce((s, a) => s + (a.timeSpentSec ?? 45), 0) / 60));
    const xp = correct * 10 + (attempts.length - correct) * 2;
    await this.logActivity(studentId, {
      kind: attempts[0].source === 'exam' ? 'exam' : 'practice',
      minutes,
      label: opts.label ?? 'প্রশ্ন অনুশীলন',
      xp,
    });
    const total = await this.store.count(this.ref('attempts', studentId));
    if (total >= 100) await this.grantBadge(studentId, 'questions-100');
    if (total >= 500) await this.grantBadge(studentId, 'questions-500');
    if ([...existing.values()].some((m) => m.attempts >= 5 && m.mastery >= 80))
      await this.grantBadge(studentId, 'mastery-80');
    return { recorded: attempts.length, correct, xp };
  }

  async logActivity(
    studentId: string,
    entry: { kind: ActivityEntry['kind']; minutes: number; label: string; xp?: number },
  ) {
    const minutes = Math.max(0, Math.min(600, Math.round(entry.minutes)));
    const xp = Math.max(0, Math.min(2000, entry.xp ?? Math.round(minutes * 1.5)));
    const activity = {
      id: RecordStoreService.newId('act'),
      date: dateKey(0),
      at: nowIso(),
      ...entry,
      minutes,
      xp,
    } as ActivityEntry & Entity;
    await this.store.insert(this.ref('activity', studentId), activity);
    const g = await this.awardXp(studentId, xp, entry.label);
    if (g.streak.current >= 7) await this.grantBadge(studentId, 'streak-7');
    if (g.streak.current >= 30) await this.grantBadge(studentId, 'streak-30');
    if (hourInPlatformTz() >= 22) await this.grantBadge(studentId, 'night-owl');
    return activity;
  }

  async awardXp(studentId: string, xp: number, label: string): Promise<GamificationState> {
    const g = await this.gamification(studentId);
    const today = dateKey(0);
    const yesterday = dateKey(-1);
    const streak = { ...g.streak };
    if (streak.lastActiveDate !== today) {
      streak.current = streak.lastActiveDate === yesterday ? streak.current + 1 : 1;
      streak.longest = Math.max(streak.longest, streak.current);
      streak.lastActiveDate = today;
    }
    const next: GamificationState = {
      ...g,
      xp: g.xp + xp,
      points: g.points + Math.round(xp / 4),
      streak,
      history: [{ id: RecordStoreService.newId('h'), at: nowIso(), label, xp }, ...g.history].slice(
        0,
        100,
      ),
    };
    await this.saveGamification(studentId, next);
    return next;
  }

  async grantBadge(studentId: string, badgeId: string) {
    const def = BADGES.find((b) => b[0] === badgeId);
    if (!def) return;
    const g = await this.gamification(studentId);
    if (g.badges.some((b) => b.id === badgeId)) return;
    await this.saveGamification(studentId, {
      ...g,
      badges: [...g.badges, { id: badgeId, earnedAt: nowIso() }],
    });
    await this.notifications.push([studentId], {
      portal: 'student',
      type: 'achievement',
      title: `নতুন ব্যাজ: ${def[1]}`,
      body: def[3],
      href: '/student/achievements',
      priority: 'low',
    });
  }

  async setChapterStatus(studentId: string, chapterId: string, action: ChapterAction) {
    const chapter = await this.store.find<Entity>({ collection: 'chapters', scope: '' }, chapterId);
    if (!chapter) invalid('NOT_FOUND', undefined, 404);
    const ref = this.ref('chapterProgress', studentId);
    const list = await this.store.all<ChapterProgress & Entity>(ref);
    const subjectId = String(chapter.subjectId);
    const current: ChapterProgress = list.find((c) => c.id === chapterId) ?? {
      id: chapterId,
      chapterId,
      subjectId,
      status: 'not_started',
      percent: 0,
      topicsCompleted: [],
      history: [],
    };
    const at = nowIso();
    let next: ChapterProgress;
    if (action === 'start')
      next = {
        ...current,
        status: current.status === 'completed' ? 'completed' : 'in_progress',
        lastStudiedAt: at,
        history: [
          ...current.history,
          { at, action: current.history.length ? 'resumed' : 'started' },
        ],
      };
    else if (action === 'complete')
      next = {
        ...current,
        status: 'completed',
        percent: 100,
        completedAt: at,
        lastStudiedAt: at,
        history: [...current.history, { at, action: 'completed' }],
      };
    else if (action === 'reset')
      next = {
        ...current,
        status: 'not_started',
        percent: 0,
        topicsCompleted: [],
        completedAt: undefined,
        history: [...current.history, { at, action: 'reset' }],
      };
    else {
      const totalTopics =
        action.totalTopics ??
        (await this.store.count({ collection: 'topics', scope: '' }, { chapterId: [chapterId] }));
      const done = [...new Set([...current.topicsCompleted, action.topicDone])];
      const percent = Math.min(100, Math.round((done.length / Math.max(1, totalTopics)) * 100));
      next = {
        ...current,
        topicsCompleted: done,
        percent,
        status: percent >= 100 ? 'completed' : 'in_progress',
        lastStudiedAt: at,
        completedAt: percent >= 100 ? at : current.completedAt,
        history: [...current.history, { at, action: percent >= 100 ? 'completed' : 'topic_done' }],
      };
    }
    await this.store.upsert(ref, next as ChapterProgress & Entity);
    if (next.status === 'completed' && current.status !== 'completed') {
      await this.awardXp(studentId, 150, 'অধ্যায় সম্পন্ন');
      const completed =
        list.filter((c) => c.status === 'completed' && c.id !== chapterId).length + 1;
      if (completed >= 5) await this.grantBadge(studentId, 'chapter-5');
      if (completed >= 20) await this.grantBadge(studentId, 'chapter-20');
    }
    if (action === 'start' && !list.length) await this.grantBadge(studentId, 'first-steps');
    return next;
  }

  /** Claims a weekly mission once its target is met (value computed from the student's data). */
  async claimMission(studentId: string, missionId: string) {
    const parsed = parseMissionId(missionId);
    const week = weekStartKey();
    if (!parsed || parsed.week !== week) invalid('MISSION_INVALID');
    const g = await this.gamification(studentId);
    if (g.claimedMissions.includes(missionId)) return g;
    const value = await this.missionValue(studentId, parsed.kind, week);
    const mission = MISSIONS[parsed.kind];
    if (value < mission.target) invalid('MISSION_INCOMPLETE');
    await this.saveGamification(studentId, {
      ...g,
      claimedMissions: [...g.claimedMissions, missionId],
    });
    return this.awardXp(studentId, mission.xp, 'মিশন পুরস্কার');
  }

  async missionValue(
    studentId: string,
    kind: keyof typeof MISSIONS,
    week: string,
  ): Promise<number> {
    if (kind === 'minutes') {
      const rows = await this.store.all<ActivityEntry & Entity>(this.ref('activity', studentId));
      return rows.filter((a) => a.date >= week).reduce((s, a) => s + a.minutes, 0);
    }
    if (kind === 'questions')
      return (
        await this.store.all<QuestionAttempt & Entity>(this.ref('attempts', studentId))
      ).filter((a) => a.answeredAt.slice(0, 10) >= week).length;
    if (kind === 'exams')
      return (
        await this.store.all<ExamAttempt & Entity>(this.ref('examAttempts', studentId))
      ).filter((a) => a.submittedAt && a.submittedAt.slice(0, 10) >= week).length;
    return (await this.store.all<Flashcard & Entity>(this.ref('cards', studentId))).filter(
      (c) => c.lastReviewedAt && c.lastReviewedAt.slice(0, 10) >= week,
    ).length;
  }

  async useStreakFreeze(studentId: string) {
    const g = await this.gamification(studentId);
    if (g.streak.freezeAvailable < 1) return g;
    const next = {
      ...g,
      streak: {
        ...g.streak,
        freezeAvailable: g.streak.freezeAvailable - 1,
        lastActiveDate: dateKey(0),
      },
    };
    await this.saveGamification(studentId, next);
    return next;
  }

  async updateChallenges(studentId: string, challenges: GamificationState['friendChallenges']) {
    const g = await this.gamification(studentId);
    const next = { ...g, friendChallenges: challenges.slice(0, 50) };
    await this.saveGamification(studentId, next);
    return next;
  }
}
