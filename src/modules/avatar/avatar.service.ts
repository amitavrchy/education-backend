import { Injectable } from '@nestjs/common';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import { nowIso } from '../../common/utils/dates.js';
import type { Topic } from '../../contracts/curriculum.js';
import type { Book } from '../../contracts/learning.js';
import {
  answerFromBook,
  defaultAvatarFor,
  type AvatarAnswer,
  type AvatarCitation,
  type BookAvatar,
} from '../../domain/avatar/book-avatar-engine.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

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
 * Per-book avatar teacher. Answers are composed on the server from the book's pages only
 * (deterministic engine, `simulated: true`); the stored sessions, messages, counters and
 * reports can't be written by clients directly.
 */
@Injectable()
export class AvatarService {
  private topicsCache?: { at: number; topics: Topic[] };

  constructor(private readonly store: RecordStoreService) {}

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
      simulated: true,
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
      simulated: true,
    };
    const a = answerFromBook({ book, avatar, topics, query: trimmed });
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
      simulated: true,
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
    return answerFromBook({ book, avatar, topics, query });
  }
}
