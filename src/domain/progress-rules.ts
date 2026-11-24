/**
 * Learning-engine rules (frontend services/progress.service.ts and the achievements page),
 * owned by the server so XP, streaks, badges and mission rewards can't be granted by clients.
 */
import type { TopicMastery } from '../contracts/study.js';
import type { QuestionAttempt } from '../contracts/question.js';
import { dateKey } from '../common/utils/dates.js';

export const LEVEL_XP = 1000;
export const levelFor = (xp: number) => ({
  level: Math.floor(xp / LEVEL_XP) + 1,
  into: xp % LEVEL_XP,
  next: LEVEL_XP,
});

/** [id, bn, en, descBn, descEn, icon, tier] — same catalogue as the frontend. */
export const BADGES = [
  ['first-steps', 'প্রথম পদক্ষেপ', 'First steps', 'প্রথম অধ্যায় শুরু', 'Started your first chapter'],
  ['streak-7', '৭ দিনের স্ট্রিক', '7-day streak', 'টানা ৭ দিন পড়াশোনা', 'Studied 7 days in a row'],
  [
    'streak-30',
    '৩০ দিনের স্ট্রিক',
    '30-day streak',
    'টানা ৩০ দিন পড়াশোনা',
    'Studied 30 days in a row',
  ],
  ['questions-100', 'শততম প্রশ্ন', 'Century', '১০০টি প্রশ্নের উত্তর', 'Answered 100 questions'],
  ['questions-500', 'প্রশ্নবীর', 'Question hero', '৫০০টি প্রশ্নের উত্তর', 'Answered 500 questions'],
  ['chapter-5', 'অধ্যায় জয়ী', 'Chapter champion', '৫টি অধ্যায় সম্পন্ন', 'Completed 5 chapters'],
  ['chapter-20', 'সিলেবাস যোদ্ধা', 'Syllabus warrior', '২০টি অধ্যায় সম্পন্ন', 'Completed 20 chapters'],
  ['exam-perfect', 'নিখুঁত', 'Perfect score', 'কোনো পরীক্ষায় ১০০%', '100% in an exam'],
  ['night-owl', 'নিশাচর', 'Night owl', 'রাত ১০টার পর পড়াশোনা', 'Studied after 10 pm'],
  [
    'tutor-curious',
    'জিজ্ঞাসু মন',
    'Curious mind',
    'AI টিউটরকে ২০টি প্রশ্ন',
    'Asked the AI tutor 20 questions',
  ],
  [
    'flashcard-50',
    'স্মৃতির জাদুকর',
    'Memory wizard',
    '৫০টি ফ্ল্যাশকার্ড রিভিউ',
    'Reviewed 50 flashcards',
  ],
  ['mastery-80', 'দক্ষতা অর্জন', 'Mastery', 'কোনো বিষয়ে ৮০% দক্ষতা', '80% mastery in a subject'],
] as const;

/** Exponential moving average towards 100 (correct) or 0 (wrong), as in the frontend. */
export function updateMastery(
  m: TopicMastery,
  a: Pick<QuestionAttempt, 'correct' | 'answeredAt'>,
): TopicMastery {
  const mastered = Math.round(m.mastery + 0.3 * ((a.correct ? 100 : 0) - m.mastery));
  return {
    ...m,
    attempts: m.attempts + 1,
    correct: m.correct + (a.correct ? 1 : 0),
    mastery: mastered,
    lastPracticedAt: a.answeredAt,
    trend: [...m.trend, mastered].slice(-8),
    mistakes: a.correct
      ? m.mistakes
      : { ...m.mistakes, concept_confusion: (m.mistakes.concept_confusion ?? 0) + 1 },
  };
}

/** Weeks start on Saturday (Bangladesh school week), like the achievements page. */
export function weekStartKey(now = new Date()): string {
  const day = new Date(dateKey(0, now) + 'T00:00:00Z').getUTCDay();
  return dateKey(-((day + 1) % 7), now);
}

export type MissionKind = 'questions' | 'minutes' | 'exams' | 'flashcards';

/** Weekly missions: id is `weekly-<kind>-<weekStart>`; rewards are fixed server-side. */
export const MISSIONS: Record<MissionKind, { target: number; xp: number }> = {
  questions: { target: 100, xp: 150 },
  minutes: { target: 600, xp: 200 },
  exams: { target: 3, xp: 120 },
  flashcards: { target: 50, xp: 100 },
};

export function parseMissionId(id: string): { kind: MissionKind; week: string } | null {
  const m = /^weekly-(questions|minutes|exams|flashcards)-(\d{4}-\d{2}-\d{2})$/.exec(id);
  return m ? { kind: m[1] as MissionKind, week: m[2] } : null;
}
