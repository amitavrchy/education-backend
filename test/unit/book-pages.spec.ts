import { describe, expect, it } from 'vitest';
import type { Topic } from '../../src/contracts/curriculum.js';
import type { Book } from '../../src/contracts/learning.js';
import {
  bookPage,
  defaultAvatarFor,
  searchPages,
  tokens,
} from '../../src/domain/avatar/book-pages.js';

const book = {
  id: 'book-ssc-physics-bn',
  title: { bn: 'পদার্থবিজ্ঞান', en: 'Physics (Bangla Version)' },
  subjectId: 'ssc-physics',
  language: 'bn',
  chapters: [
    {
      id: 'c1',
      title: { bn: 'ভৌত রাশি ও পরিমাপ', en: 'Physical Quantities' },
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
    id: 't1',
    chapterId: 'ssc-physics-c1',
    subjectId: 'ssc-physics',
    order: 1,
    title: { bn: 'মৌলিক রাশি', en: 'Fundamental quantities' },
    verified: true,
  },
  {
    id: 't2',
    chapterId: 'ssc-physics-c2',
    subjectId: 'ssc-physics',
    order: 2,
    title: { bn: 'ত্বরণ', en: 'Acceleration' },
    verified: true,
  },
] as Topic[];

const avatar = defaultAvatarFor(book, '2026-11-27T00:00:00.000Z');

describe('book pages (avatar retrieval)', () => {
  it('builds a stable default avatar for a book', () => {
    expect(avatar.id).toBe('av-book-ssc-physics-bn');
    expect(defaultAvatarFor(book, 'x').appearance).toEqual(avatar.appearance);
    expect(avatar.title.bn).toBe('পদার্থবিজ্ঞান শিক্ষক');
  });

  it('generates pages from the chapter topics', () => {
    expect(bookPage(book, topics, 8).heading).toBe('ত্বরণ');
  });

  it('finds the pages of the asked topic, within the chapter scope', () => {
    const q = 'ত্বরণ কাকে বলে?';
    const pages = searchPages({ book, avatar, topics, query: q }, tokens(q), 'bn');
    expect(pages[0].chapterId).toBe('ssc-physics-c2');
    const scoped = { ...avatar, scopeChapterIds: ['ssc-physics-c1'] };
    expect(
      searchPages({ book, avatar: scoped, topics, query: q }, tokens(q), 'bn').every(
        (p) => p.chapterId === 'ssc-physics-c1',
      ),
    ).toBe(true);
  });
});
