import { Injectable } from '@nestjs/common';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import { nowIso } from '../../common/utils/dates.js';
import type { Topic } from '../../contracts/curriculum.js';
import type { Book } from '../../contracts/learning.js';
import {
  defaultAvatarFor,
  scopeChapters,
  searchPages,
  tokens,
  type AvatarCitation,
  type BookAvatar,
} from '../../domain/avatar/book-pages.js';
import { AiServiceClient } from '../../integrations/ai-service/ai-service.client.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

export interface AvatarAnswer {
  text: string;
  spoken: string;
  citations: AvatarCitation[];
  grounded: 'book' | 'greeting' | 'out_of_scope';
  followUps: string[];
  simulated: boolean;
}

export interface AvatarSession {
  id: string;
  bookId: string;
  avatarId: string;
  studentId: string;
  title: string;
  startedAt: string;
  lastAt: string;
  messageCount: number;
  voiceTurns: number;
  minutes: number;
}

export interface AvatarMessage {
  id: string;
  sessionId: string;
  role: 'student' | 'avatar';
  text: string;
  spoken?: string;
  inputMode?: 'text' | 'voice';
  at: string;
  citations: AvatarCitation[];
  grounded?: AvatarAnswer['grounded'];
  followUps: string[];
  feedback?: 'up' | 'down';
  flagged?: boolean;
  simulated: boolean;
}

export interface AvatarReport {
  id: string;
  bookId: string;
  avatarId: string;
  studentId: string;
  question: string;
  answer: string;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

type Row<T> = T & Entity;

const AVATARS = { collection: 'bookAvatars', scope: '' };
const REPORTS = { collection: 'avatarReports', scope: '' };
const BOOKS = { collection: 'books', scope: '' };
const TOPICS = { collection: 'topics', scope: '' };
const sessionsOf = (studentId: string) => ({ collection: 'avatarSessions', scope: studentId });
const messagesOf = (studentId: string) => ({ collection: 'avatarMessages', scope: studentId });

/**
 * Per-book avatar teacher. The book's pages are searched here and the AI service writes the
 * answer from them only; the stored sessions, messages, counters and reports can't be written by
 * clients directly.
 */
@Injectable()
export class AvatarService {
  private topicsCache?: { at: number; topics: Topic[] };

  constructor(
    private readonly store: RecordStoreService,
    private readonly ai: AiServiceClient,
  ) {}

  /** Finds the book pages for the question here; the AI service writes the answer from them. */
  private async compose(
    book: Book,
    avatar: BookAvatar,
    topics: Topic[],
    query: string,
    history: AvatarMessage[] = [],
  ): Promise<AvatarAnswer> {
    const lang = /[ঀ-৿]/.test(query) ? 'bn' : /[a-z]/i.test(query) ? 'en' : avatar.voice.language;
    const pages = searchPages({ book, avatar, topics, query }, tokens(query), lang).slice(0, 5);
    const res = await this.ai.avatarAnswer({
      query,
      book_title: lang === 'en' ? book.title.en : book.title.bn,
      avatar_name: lang === 'en' ? avatar.name.en : avatar.name.bn,
      language: lang,
      persona: {
        style: avatar.persona.style,
        answer_length: avatar.persona.answerLength,
        use_examples: avatar.persona.useExamples,
      },
      strict_scope: avatar.strictBookScope,
      chapters: scopeChapters({ book, avatar, topics, query }).map((c) =>
        lang === 'en' ? c.title.en : c.title.bn,
      ),
      pages: pages.map((p) => ({
        page: p.page,
        chapter_title: p.chapterTitle,
        heading: p.heading ?? '',
        text: p.excerpt,
      })),
      history: history.slice(-6).map((m) => ({
        role: m.role === 'student' ? ('user' as const) : ('assistant' as const),
        content: m.text,
      })),
    });
    const byPage = new Map(pages.map((p) => [p.page, p]));
    return {
      text: res.text,
      spoken: res.spoken,
      citations: res.cited_pages
        .map((n) => byPage.get(n))
        .filter((p) => !!p)
        .map((p) => ({
          page: p.page,
          chapterTitle: p.chapterTitle,
          heading: p.heading,
          excerpt: p.excerpt,
        })),
      grounded: res.grounded,
      followUps: res.follow_ups,
      simulated: res.simulated,
    };
  }

  private async topics(): Promise<Topic[]> {
    if (this.topicsCache && Date.now() - this.topicsCache.at < 60_000)
      return this.topicsCache.topics;
    const topics = await this.store.all<Row<Topic>>(TOPICS);
    this.topicsCache = { at: Date.now(), topics };
    return topics;
  }

  private async book(bookId: string): Promise<Book> {
    const book = await this.store.find<Row<Book>>(BOOKS, bookId);
    if (!book || book.status !== 'published') notFound('Book');
    return book;
  }

  /** The book's avatar, created with the defaults the first time anyone asks for it. */
  async forBook(bookId: string): Promise<BookAvatar> {
    const [found] = await this.store.all<Row<BookAvatar>>(AVATARS, 'all', {
      filters: { bookId: [bookId] },
    });
    if (found) return found;
    const book = await this.book(bookId);
    return this.store.upsert(AVATARS, defaultAvatarFor(book, nowIso()) as Row<BookAvatar>);
  }

  private async bumpStats(avatar: BookAvatar, delta: Partial<BookAvatar['stats']>) {
    const fresh = (await this.store.find<Row<BookAvatar>>(AVATARS, avatar.id)) ?? avatar;
    const stats = { ...fresh.stats };
    for (const [k, v] of Object.entries(delta) as [keyof BookAvatar['stats'], number][])
      stats[k] = (stats[k] ?? 0) + v;
    await this.store.replace(AVATARS, { ...fresh, stats });
  }

  async startSession(studentId: string, bookId: string) {
    const avatar = await this.forBook(bookId);
    if (avatar.status !== 'active') notFound('Avatar');
    const now = nowIso();
    const session: AvatarSession = {
      id: RecordStoreService.newId('as'),
      bookId,
      avatarId: avatar.id,
      studentId,
      title: 'নতুন সেশন',
      startedAt: now,
      lastAt: now,
      messageCount: 0,
      voiceTurns: 0,
      minutes: 0,
    };
    const text = avatar.voice.language === 'en' ? avatar.greeting.en : avatar.greeting.bn;
    const greeting: AvatarMessage = {
      id: RecordStoreService.newId('am'),
      sessionId: session.id,
      role: 'avatar',
      text,
      spoken: text,
      at: now,
      citations: [],
      grounded: 'greeting',
      followUps: [],
      simulated: false,
    };
    await this.store.insert(sessionsOf(studentId), session as Row<AvatarSession>);
    await this.store.insert(messagesOf(studentId), greeting as Row<AvatarMessage>);
    await this.bumpStats(avatar, { sessions: 1 });
    return { session, greeting };
  }

  async ask(studentId: string, sessionId: string, text: string, inputMode: 'text' | 'voice') {
    const trimmed = text.trim();
    if (!trimmed) invalid('EMPTY_QUESTION');
    const session = await this.store.find<Row<AvatarSession>>(sessionsOf(studentId), sessionId);
    if (!session) notFound('Session');
    const [avatar, book, topics] = await Promise.all([
      this.forBook(session.bookId),
      this.book(session.bookId),
      this.topics(),
    ]);
    const now = nowIso();
    const question: AvatarMessage = {
      id: RecordStoreService.newId('am'),
      sessionId,
      role: 'student',
      text: trimmed,
      inputMode,
      at: now,
      citations: [],
      followUps: [],
      simulated: false,
    };
    const thread = await this.store.all<Row<AvatarMessage>>(messagesOf(studentId), 'all', {
      filters: { sessionId: [sessionId] },
    });
    thread.sort((x, y) => x.at.localeCompare(y.at));
    const a = await this.compose(book, avatar, topics, trimmed, thread);
    const reply: AvatarMessage = {
      id: RecordStoreService.newId('am'),
      sessionId,
      role: 'avatar',
      text: a.text,
      spoken: a.spoken,
      at: new Date(Date.parse(now) + 1).toISOString(),
      citations: a.citations,
      grounded: a.grounded,
      followUps: a.followUps,
      simulated: a.simulated,
    };
    await this.store.insertMany(messagesOf(studentId), [question, reply] as Row<AvatarMessage>[]);
    const first = session.messageCount === 0;
    await this.store.replace(sessionsOf(studentId), {
      ...session,
      lastAt: reply.at,
      messageCount: session.messageCount + 2,
      voiceTurns: session.voiceTurns + (inputMode === 'voice' ? 1 : 0),
      minutes: Math.max(1, Math.round((Date.now() - Date.parse(session.startedAt)) / 60_000)),
      title: first ? trimmed.slice(0, 40) : session.title,
    });
    await this.bumpStats(avatar, {
      questions: 1,
      outOfScope: a.grounded === 'out_of_scope' ? 1 : 0,
    });
    return { question, reply };
  }

  private async message(studentId: string, messageId: string) {
    const m = await this.store.find<Row<AvatarMessage>>(messagesOf(studentId), messageId);
    if (!m) notFound('Message');
    return m;
  }

  async feedback(studentId: string, messageId: string, value: 'up' | 'down') {
    const m = await this.message(studentId, messageId);
    if (m.role !== 'avatar') invalid('NOT_AN_ANSWER');
    const previous = m.feedback;
    const next = await this.store.replace(messagesOf(studentId), { ...m, feedback: value });
    if (previous !== value) {
      const session = await this.store.find<Row<AvatarSession>>(sessionsOf(studentId), m.sessionId);
      const avatar = session && (await this.store.find<Row<BookAvatar>>(AVATARS, session.avatarId));
      if (avatar)
        await this.bumpStats(avatar, {
          helpful: (value === 'up' ? 1 : 0) - (previous === 'up' ? 1 : 0),
          notHelpful: (value === 'down' ? 1 : 0) - (previous === 'down' ? 1 : 0),
        });
    }
    return next;
  }

  async report(studentId: string, messageId: string, reason: string) {
    if (reason.trim().length < 3) invalid('REASON_REQUIRED');
    const m = await this.message(studentId, messageId);
    await this.store.replace(messagesOf(studentId), { ...m, flagged: true });
    const session = await this.store.find<Row<AvatarSession>>(sessionsOf(studentId), m.sessionId);
    if (!session) notFound('Session');
    const history = (
      await this.store.all<Row<AvatarMessage>>(messagesOf(studentId), 'all', {
        filters: { sessionId: [m.sessionId] },
      })
    )
      .filter((x) => x.at < m.at && x.role === 'student')
      .sort((a, b) => b.at.localeCompare(a.at));
    const now = nowIso();
    const report: AvatarReport = {
      id: RecordStoreService.newId('ar'),
      bookId: session.bookId,
      avatarId: session.avatarId,
      studentId,
      question: history[0]?.text ?? '',
      answer: m.text,
      reason: reason.trim(),
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert(REPORTS, report as Row<AvatarReport>, { ownerField: 'studentId' });
  }

  /** Guardian view: counts per book, never message content. */
  async usage(studentId: string) {
    const sessions = await this.store.all<Row<AvatarSession>>(sessionsOf(studentId));
    const byBook = new Map<
      string,
      { bookId: string; sessions: number; questions: number; minutes: number; lastAt: string }
    >();
    for (const s of sessions) {
      const cur = byBook.get(s.bookId) ?? {
        bookId: s.bookId,
        sessions: 0,
        questions: 0,
        minutes: 0,
        lastAt: s.lastAt,
      };
      cur.sessions += 1;
      cur.questions += Math.floor(s.messageCount / 2);
      cur.minutes += s.minutes;
      if (s.lastAt > cur.lastAt) cur.lastAt = s.lastAt;
      byBook.set(s.bookId, cur);
    }
    return [...byBook.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  /** Staff "test chat" with an unsaved draft: nothing is stored. */
  async preview(avatar: BookAvatar, query: string) {
    const [book, topics] = await Promise.all([
      this.store.find<Row<Book>>(BOOKS, avatar.bookId),
      this.topics(),
    ]);
    if (!book) notFound('Book');
    return this.compose(book, avatar, topics, query);
  }
}
