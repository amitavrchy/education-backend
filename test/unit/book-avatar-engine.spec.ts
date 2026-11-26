import { describe, expect, it } from 'vitest';
import type { Topic } from '../../src/contracts/curriculum.js';
import type { Book } from '../../src/contracts/learning.js';
import {
  answerFromBook,
  defaultAvatarFor,
  toSpoken,
} from '../../src/domain/avatar/book-avatar-engine.js';

const book = {
  id: 'book-ssc-physics-bn',
  title: { bn: 'পদার্থবিজ্ঞান', en: 'Physics (Bangla Version)' },
  subjectId: 'ssc-physics',
  language: 'bn',
  chapters: [
    {
      id: 'c1',
      title: { bn: 'ভৌত রাশি ও পরিমাপ', en: 'Physical Quantities and Measurement' },
      startPage: 1,
      endPage: 6,
      chapterId: 'ssc-physics-c1',
    },
    {
      id: 'c2',
      title: { bn: 'গতি', en: 'Motion' },
      startPage: 7,
      endPage: 12,
      chapterId: 'ssc-physics-c2',
    },
  ],
} as unknown as Book;

const topics = [
  {
    id: 'ssc-physics-c1-t1',
    chapterId: 'ssc-physics-c1',
    subjectId: 'ssc-physics',
    order: 1,
    title: { bn: 'মৌলিক ও লব্ধ রাশি', en: 'Fundamental and derived quantities' },
    verified: true,
  },
  {
    id: 'ssc-physics-c2-t2',
    chapterId: 'ssc-physics-c2',
    subjectId: 'ssc-physics',
    order: 2,
    title: { bn: 'ত্বরণ', en: 'Acceleration' },
    verified: true,
  },
] as Topic[];

const avatar = defaultAvatarFor(book, '2026-11-26T00:00:00.000Z');

describe('book avatar engine', () => {
  it('builds a stable default avatar for a book', () => {
    expect(avatar.id).toBe('av-book-ssc-physics-bn');
    expect(defaultAvatarFor(book, 'x').appearance).toEqual(avatar.appearance);
    expect(avatar.title.bn).toBe('পদার্থবিজ্ঞান শিক্ষক');
    expect(avatar.status).toBe('active');
  });

  it('answers a book question with a page citation', () => {
    const a = answerFromBook({ book, avatar, topics, query: 'ত্বরণ কাকে বলে?' });
    expect(a.grounded).toBe('book');
    expect(a.citations[0].page).toBeGreaterThanOrEqual(7);
    expect(a.text).toContain('📖');
  });

  it('refuses questions outside the book', () => {
    const a = answerFromBook({ book, avatar, topics, query: 'photosynthesis in plants' });
    expect(a.grounded).toBe('out_of_scope');
    expect(a.citations).toEqual([]);
    expect(a.followUps.length).toBeGreaterThan(0);
  });

  it('greets and lists chapters', () => {
    expect(answerFromBook({ book, avatar, topics, query: 'hello' }).grounded).toBe('greeting');
    const toc = answerFromBook({ book, avatar, topics, query: 'কী কী অধ্যায় আছে' });
    expect(toc.text).toContain('2টি');
  });

  it('respects the chapter scope', () => {
    const scoped = { ...avatar, scopeChapterIds: ['ssc-physics-c1'] };
    expect(answerFromBook({ book, avatar: scoped, topics, query: 'ত্বরণ কাকে বলে?' }).grounded).toBe(
      'out_of_scope',
    );
  });

  it('speaks without markdown or LaTeX', () => {
    expect(toSpoken('**F** = $$v = u + at$$', 'en')).toBe('F = formula: v = u + at.');
  });
});
