import { Injectable } from '@nestjs/common';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import { nowIso } from '../../common/utils/dates.js';
import type { Question } from '../../contracts/question.js';
import { gradeObjective, seededShuffle } from '../../domain/grading.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

const CHALLENGES = { collection: 'challenges', scope: '' };
const PROFILES = { collection: 'studentProfiles', scope: '' };
const QUESTIONS = { collection: 'questions', scope: '' };
const QUIZ_SIZE = 5;
const EXPIRY_DAYS = 7;

interface Profile {
  id: string;
  grade?: number;
  subjectIds?: string[];
  privacy?: { showOnLeaderboard?: boolean };
}

export interface Challenge {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  subjectId: string;
  title: string;
  questionIds: string[];
  status: 'pending' | 'active' | 'done' | 'declined' | 'expired';
  /** Correct answers per participant, set when they finish the quiz. */
  scores: Record<string, number>;
  winnerId?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

/** Shown to other students: first name and an initial (minors' privacy). */
export function publicName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${[...parts[parts.length - 1]][0]}.` : (parts[0] ?? '');
}

/**
 * Leaderboard and friend challenges between real students. Only students whose privacy settings
 * allow it appear (studentProfiles.privacy.showOnLeaderboard) and names are shortened.
 */
@Injectable()
export class SocialService {
  constructor(
    private readonly store: RecordStoreService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async profile(id: string) {
    return this.store.find<Profile & Entity>(PROFILES, id);
  }

  /** Students who share the scope with `userId` and allow being shown (always includes the user). */
  private async peers(userId: string, scope: 'class' | 'school' | 'all') {
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { institutionId: true } });
    const myProfile = await this.profile(userId);
    const users = await this.prisma.user.findMany({
      where: {
        role: 'student',
        deletedAt: null,
        ...(scope !== 'all' && me?.institutionId ? { institutionId: me.institutionId } : {}),
      },
      select: { id: true, name: true },
      take: 2000,
    });
    const profiles = new Map(
      (await this.store.findMany<Profile & Entity>(PROFILES, users.map((u) => u.id))).map((p) => [p.id, p]),
    );
    return users.filter((u) => {
      if (u.id === userId) return true;
      const p = profiles.get(u.id);
      if (p?.privacy?.showOnLeaderboard === false) return false;
      if (scope === 'class' && myProfile?.grade && p?.grade && p.grade !== myProfile.grade) return false;
      return true;
    });
  }

  /** Weekly XP ranking from the last 7 days of study activity. */
  async leaderboard(userId: string, scope: 'class' | 'school' | 'all') {
    const peers = await this.peers(userId, scope);
    const ids = peers.map((p) => p.id);
    const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.prisma.$queryRaw<{ scope: string; xp: bigint }[]>`
      SELECT "scope", COALESCE(SUM(("data"->>'xp')::int), 0)::bigint AS xp FROM "records"
      WHERE "collection" = 'activity' AND "scope" = ANY(${ids}::text[]) AND "data"->>'date' >= ${since}
      GROUP BY "scope"`;
    const xp = new Map(rows.map((r) => [r.scope, Number(r.xp)]));
    const ranked = peers
      .map((p) => ({ id: p.id, name: publicName(p.name), xp: xp.get(p.id) ?? 0, me: p.id === userId }))
      .filter((r) => r.xp > 0 || r.me)
      .sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name));
    const withRank = ranked.map((r, i) => ({ rank: i + 1, name: r.name, xp: r.xp, me: r.me }));
    const mine = withRank.find((r) => r.me);
    const top = withRank.slice(0, 10);
    return {
      scope,
      since,
      participants: withRank.length,
      rows: mine && mine.rank > 10 ? [...top, mine] : top,
    };
  }

  /** Classmates the student can challenge (same institution, visible on the leaderboard). */
  async classmates(userId: string) {
    const peers = await this.peers(userId, 'school');
    return peers
      .filter((p) => p.id !== userId)
      .slice(0, 200)
      .map((p) => ({ id: p.id, name: publicName(p.name) }));
  }

  private view(c: Challenge, userId: string) {
    const other = c.fromId === userId ? c.toId : c.fromId;
    return {
      ...c,
      friend: c.fromId === userId ? c.toName : c.fromName,
      incoming: c.toId === userId,
      myScore: c.scores[userId],
      theirScore: c.status === 'done' ? c.scores[other] : undefined,
      played: userId in c.scores,
      outcome:
        c.status !== 'done' ? undefined : c.winnerId === userId ? 'won' : c.winnerId ? 'lost' : 'draw',
    };
  }

  async list(userId: string) {
    const [sent, received] = await Promise.all([
      this.store.all<Challenge & Entity>(CHALLENGES, 'all', { filters: { fromId: [userId] } }),
      this.store.all<Challenge & Entity>(CHALLENGES, 'all', { filters: { toId: [userId] } }),
    ]);
    const now = nowIso();
    return [...sent, ...received]
      .map((c) => (['pending', 'active'].includes(c.status) && c.expiresAt < now ? { ...c, status: 'expired' as const } : c))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((c) => this.view(c, userId));
  }

  async create(userId: string, input: { friendId: string; subjectId: string }) {
    if (input.friendId === userId) invalid('VALIDATION');
    const allowed = await this.classmates(userId);
    const friend = allowed.find((p) => p.id === input.friendId) ?? notFound('Student');
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const pool = (
      await this.store.all<Question & Entity>(QUESTIONS, 'all', {
        filters: { subjectId: [input.subjectId], status: ['published'], type: ['mcq'] },
      })
    ).filter((q) => q.options?.length && q.correctOptionId);
    if (pool.length < QUIZ_SIZE) invalid('NOT_ENOUGH_QUESTIONS', undefined, 422);
    const subject = await this.store.find<{ name: { bn: string } } & Entity>(
      { collection: 'subjects', scope: '' },
      input.subjectId,
    );
    const now = nowIso();
    const challenge: Challenge = {
      id: RecordStoreService.newId('chl'),
      fromId: userId,
      fromName: publicName(me?.name ?? ''),
      toId: friend.id,
      toName: friend.name,
      subjectId: input.subjectId,
      title: `${subject?.name.bn ?? input.subjectId}: ${QUIZ_SIZE} প্রশ্নের কুইজ`,
      questionIds: seededShuffle(pool, `${userId}:${now}`)
        .slice(0, QUIZ_SIZE)
        .map((q) => q.id),
      status: 'pending',
      scores: {},
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + EXPIRY_DAYS * 86_400_000).toISOString(),
    };
    await this.store.insert(CHALLENGES, challenge as Challenge & Entity);
    await this.notifications.push([friend.id], {
      portal: 'student',
      type: 'achievement',
      title: 'নতুন চ্যালেঞ্জ!',
      body: `${challenge.fromName} তোমাকে "${challenge.title}" চ্যালেঞ্জ করেছে।`,
      href: '/student/achievements?tab=social',
      priority: 'normal',
    });
    return this.view(challenge, userId);
  }

  private async mine(userId: string, id: string) {
    const c = await this.store.find<Challenge & Entity>(CHALLENGES, id);
    if (!c || (c.fromId !== userId && c.toId !== userId)) notFound('Challenge');
    return c;
  }

  async respond(userId: string, id: string, accept: boolean) {
    const c = await this.mine(userId, id);
    if (c.toId !== userId || c.status !== 'pending') invalid('INVALID_TRANSITION');
    const next: Challenge = { ...c, status: accept ? 'active' : 'declined', updatedAt: nowIso() };
    await this.store.replace(CHALLENGES, next as Challenge & Entity);
    if (!accept)
      await this.notifications.push([c.fromId], {
        portal: 'student',
        type: 'achievement',
        title: 'চ্যালেঞ্জ ফিরিয়ে দেওয়া হয়েছে',
        body: `${c.toName} "${c.title}" চ্যালেঞ্জটি নেয়নি।`,
        href: '/student/achievements?tab=social',
        priority: 'low',
      });
    return this.view(next, userId);
  }

  /** The quiz questions without answers (for a participant who has not played yet). */
  async quiz(userId: string, id: string) {
    const c = await this.mine(userId, id);
    const questions = await this.store.findMany<Question & Entity>(QUESTIONS, c.questionIds);
    const done = userId in c.scores;
    return questions.map((q) => ({
      id: q.id,
      stem: q.stem,
      options: q.options ?? [],
      ...(done ? { correctOptionId: q.correctOptionId, explanation: q.explanation } : {}),
    }));
  }

  async submit(userId: string, id: string, answers: Record<string, string>) {
    const c = await this.mine(userId, id);
    if (userId in c.scores) invalid('ALREADY_SUBMITTED', undefined, 409);
    if (c.status === 'declined' || c.status === 'done' || c.expiresAt < nowIso()) invalid('INVALID_TRANSITION');
    if (c.toId === userId && c.status === 'pending') c.status = 'active';
    const questions = await this.store.findMany<Question & Entity>(QUESTIONS, c.questionIds);
    const score = questions.filter(
      (q) => gradeObjective(q, { optionId: answers[q.id] }) === true,
    ).length;
    const scores = { ...c.scores, [userId]: score };
    const both = c.fromId in scores && c.toId in scores;
    const winnerId = both
      ? scores[c.fromId] === scores[c.toId]
        ? null
        : scores[c.fromId] > scores[c.toId]
          ? c.fromId
          : c.toId
      : undefined;
    const next: Challenge = {
      ...c,
      scores,
      status: both ? 'done' : c.status,
      winnerId,
      updatedAt: nowIso(),
    };
    await this.store.replace(CHALLENGES, next as Challenge & Entity);
    const other = c.fromId === userId ? c.toId : c.fromId;
    await this.notifications.push([other], {
      portal: 'student',
      type: 'achievement',
      title: both ? 'চ্যালেঞ্জের ফলাফল' : 'চ্যালেঞ্জে তোমার পালা',
      body: both
        ? `"${c.title}": ${scores[other]}–${scores[userId]}${winnerId === other ? ' — তুমি জিতেছ!' : winnerId ? '' : ' — ড্র'}`
        : `${c.fromId === userId ? c.fromName : c.toName} কুইজ শেষ করেছে (${score}/${questions.length})। এবার তোমার পালা!`,
      href: '/student/achievements?tab=social',
      priority: 'normal',
    });
    return this.view(next, userId);
  }
}
