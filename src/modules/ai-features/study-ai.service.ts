import { Injectable } from '@nestjs/common';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import { nowIso } from '../../common/utils/dates.js';
import type { Chapter, Subject, Topic } from '../../contracts/curriculum.js';
import type { SourcePassage } from '../../contracts/learning.js';
import { passagesFor } from '../../domain/retrieval.js';
import { AiServiceClient, aiPassage } from '../../integrations/ai-service/ai-service.client.js';
import { UsageService } from '../billing/usage.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

const G = (collection: string) => ({ collection, scope: '' });
type Lang = 'bn' | 'en' | 'mixed';

/** Seconds per character when the device's TTS reads Bangla (same estimate as the apps). */
const CPS = 13;

export interface VoiceInput {
  text: string;
  mode: 'tutor' | 'oral_exam';
  language: Lang;
  subjectId?: string;
  oralQuestion?: string;
  turns: { speaker: 'student' | 'tutor'; text: string }[];
}

export interface NoteInput {
  kind: string;
  chapterId?: string;
  topicId?: string;
  questionText?: string;
  answerText?: string;
  conversation?: string;
  uploadText?: string;
  language: Lang;
}

/**
 * Study features written by the AI service (voice tutor, audio lessons, flashcards, notes,
 * English writing feedback). This side checks quotas, gathers the chapter and its textbook
 * passages, and returns the results in the apps' contracts.
 */
@Injectable()
export class StudyAiService {
  constructor(
    private readonly ai: AiServiceClient,
    private readonly store: RecordStoreService,
    private readonly usage: UsageService,
  ) {}

  private async chapter(chapterId: string) {
    const chapter =
      (await this.store.find<Chapter & Entity>(G('chapters'), chapterId)) ?? notFound('Chapter');
    const [subject, topics, passages] = await Promise.all([
      this.store.find<Subject & Entity>(G('subjects'), chapter.subjectId),
      this.store.all<Topic & Entity>(G('topics'), 'all', { filters: { chapterId: [chapterId] } }),
      this.store.all<SourcePassage & Entity>(G('kbPassages'), 'all', {
        filters: { chapterId: [chapterId] },
      }),
    ]);
    topics.sort((a, b) => a.order - b.order);
    return { chapter, subject, topics, passages };
  }

  async voiceReply(studentId: string, input: VoiceInput) {
    await this.usage.consume(studentId, 'voice');
    const subject = input.subjectId
      ? await this.store.find<Subject & Entity>(G('subjects'), input.subjectId)
      : undefined;
    const res = await this.ai.voiceReply({
      text: input.text,
      mode: input.mode,
      language: input.language,
      subject: subject?.name.en,
      oral_question: input.oralQuestion,
      turns: input.turns.slice(-10),
    });
    return {
      text: res.text,
      nextQuestion: res.next_question || undefined,
      score: res.score ?? undefined,
      simulated: res.simulated,
    };
  }

  /** Writes a new audio lesson for a chapter into the shared lesson catalogue. */
  async audioLesson(userId: string, chapterId: string, minutes: number) {
    await this.usage.consume(userId, 'ai');
    const { chapter, subject, topics, passages } = await this.chapter(chapterId);
    const res = await this.ai.audioLesson({
      subject: subject?.name.bn ?? chapter.subjectId,
      chapter: chapter.title.bn,
      topics: topics.map((t) => t.title.bn),
      passages: passagesFor(passages, { chapterId }).map(aiPassage),
      language: 'bn',
      minutes,
    });
    if (!res.segments.length) invalid('NO_ANSWER', undefined, 502);
    let t = 0;
    const segments = res.segments.map((s, i) => {
      const seg = { id: `seg-${i}`, startSec: Math.round(t), title: s.title, text: s.text };
      t += s.text.length / CPS + 1;
      return seg;
    });
    const last = segments[segments.length - 1];
    const lesson = {
      id: RecordStoreService.newId('aud'),
      title: { bn: res.title, en: `${chapter.title.en} — audio lesson` },
      kind: 'generated',
      subjectId: chapter.subjectId,
      chapterId,
      language: 'bn',
      durationSec: Math.round(last.startSec + last.text.length / CPS),
      segments,
      createdAt: nowIso(),
      createdBy: userId,
      simulated: res.simulated,
    };
    return this.store.insert(G('audioLessons'), lesson);
  }

  /**
   * Card drafts for a chapter, or made from the student's own material (a note, a tutor
   * conversation, their mistakes). The app saves the ones the student keeps into a deck.
   */
  async flashcards(
    studentId: string,
    input: { chapterId?: string; count: number; sourceText?: string; title?: string },
  ) {
    await this.usage.consume(studentId, 'ai');
    let subject = '';
    let chapterTitle = input.title ?? '';
    let topics: string[] = [];
    let passages: SourcePassage[] = [];
    if (input.chapterId) {
      const c = await this.chapter(input.chapterId);
      subject = c.subject?.name.bn ?? c.chapter.subjectId;
      chapterTitle = c.chapter.title.bn;
      topics = c.topics.map((t) => t.title.bn);
      passages = passagesFor(c.passages, { chapterId: input.chapterId });
    }
    if (!input.chapterId && !input.sourceText?.trim()) invalid('VALIDATION');
    const res = await this.ai.flashcards({
      subject,
      chapter: chapterTitle,
      topics,
      passages: passages.map(aiPassage),
      count: input.count,
      language: 'bn',
      source_text: input.sourceText?.slice(0, 30_000),
    });
    return {
      cards: res.cards.map((c) => ({
        front: c.front,
        back: c.back,
        hint: c.hint || undefined,
        tags: c.tag ? [c.tag] : [],
      })),
      simulated: res.simulated,
    };
  }

  /** Pronunciation score for a sentence: a recording (data: URL) or the device transcript. */
  async pronunciation(studentId: string, input: { target: string; audio?: string; transcript?: string }) {
    await this.usage.consume(studentId, 'voice');
    const m = input.audio ? /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/i.exec(input.audio) : null;
    if (input.audio && !m) invalid('INVALID_FILE', undefined, 422);
    const type = m?.[1].toLowerCase().replace('audio/x-wav', 'audio/wav').replace('audio/x-m4a', 'audio/mp4');
    const res = await this.ai.pronunciation({
      target: input.target,
      audio: m ? { media_type: type!, data: m[2] } : undefined,
      transcript: input.transcript,
    });
    return {
      transcript: res.transcript,
      score: res.score,
      accuracy: res.accuracy,
      fluency: res.fluency,
      completeness: res.completeness,
      words: res.words,
      tips: res.tips,
      simulated: res.simulated,
    };
  }

  /**
   * A day-by-day study plan for the student's subjects, weighted towards their weak chapters
   * (mastery from practice and exams). Tasks come back in the apps' StudyTask shape (not saved).
   */
  async plan(
    studentId: string,
    input: {
      subjectIds: string[];
      weakChapterIds: string[];
      examDate?: string;
      startDate: string;
      days: number;
      dailyMinutes: number;
      startTime: string;
      goal?: string;
    },
  ) {
    await this.usage.consume(studentId, 'ai');
    const [chapters, subjects, mastery] = await Promise.all([
      this.store.all<Chapter & Entity>(G('chapters'), 'all', { filters: { subjectId: input.subjectIds } }),
      this.store.all<Subject & Entity>(G('subjects'), 'all', { filters: { id: input.subjectIds } }),
      this.store.all<{ chapterId: string; mastery: number } & Entity>({ collection: 'mastery', scope: studentId }),
    ]);
    if (!chapters.length) invalid('VALIDATION');
    const subjectName = new Map(subjects.map((s) => [s.id, s.name.bn]));
    const byChapter = new Map<string, number[]>();
    for (const m of mastery) byChapter.set(m.chapterId, [...(byChapter.get(m.chapterId) ?? []), m.mastery]);
    const level = (id: string) => {
      const list = byChapter.get(id);
      return list?.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0;
    };
    const rows = chapters
      .sort((a, b) => a.subjectId.localeCompare(b.subjectId) || a.number - b.number)
      .map((c) => ({ id: c.id, subject: subjectName.get(c.subjectId) ?? c.subjectId, title: c.title.bn, mastery: level(c.id) }));
    const weak = rows.filter(
      (r) => input.weakChapterIds.includes(r.id) || (byChapter.has(r.id) && r.mastery < 50),
    );
    const res = await this.ai.plan({
      goal: input.goal ?? '',
      exam_date: input.examDate,
      start_date: input.startDate,
      days: input.days,
      minutes_per_day: input.dailyMinutes,
      weak_chapters: weak.slice(0, 40),
      chapters: rows.filter((r) => !weak.includes(r)).slice(0, 100),
      language: 'bn',
    });
    const subjectOf = new Map(chapters.map((c) => [c.id, c.subjectId]));
    const TYPE: Record<string, string> = {
      read: 'reading',
      practice: 'practice',
      revision: 'revision',
      mock_test: 'exam_prep',
      flashcards: 'revision',
    };
    const [h0, m0] = input.startTime.split(':').map(Number);
    const clock = new Map<string, number>();
    const reminded = new Set<string>();
    const now = nowIso();
    const tasks = res.tasks.map((t) => {
      const at = clock.get(t.date) ?? h0 * 60 + (m0 || 0);
      clock.set(t.date, at + t.minutes + 10);
      const hh = String(Math.min(23, Math.floor(at / 60))).padStart(2, '0');
      const mm = String(at % 60).padStart(2, '0');
      return {
        id: RecordStoreService.newId('task'),
        title: t.title,
        subjectId: subjectOf.get(t.chapter_id),
        chapterId: t.chapter_id,
        type: TYPE[t.kind] ?? 'study',
        date: t.date,
        start: `${hh}:${mm}`,
        durationMinutes: t.minutes,
        status: 'scheduled',
        priority: weak.some((w) => w.id === t.chapter_id) ? 'high' : 'medium',
        reminder: !reminded.has(t.date) && !!reminded.add(t.date),
        source: 'generated',
        createdAt: now,
        updatedAt: now,
      };
    });
    return { summary: res.summary, tasks, simulated: res.simulated };
  }

  async note(studentId: string, input: NoteInput) {
    await this.usage.consume(studentId, 'ai');
    let subjectName = '';
    let chapterTitle = '';
    let topicTitle = '';
    let topicTitles: string[] = [];
    let passages: SourcePassage[] = [];
    const topic = input.topicId
      ? await this.store.find<Topic & Entity>(G('topics'), input.topicId)
      : undefined;
    const chapterId = input.chapterId ?? topic?.chapterId;
    if (chapterId) {
      const c = await this.chapter(chapterId);
      subjectName = c.subject?.name.bn ?? '';
      chapterTitle = c.chapter.title.bn;
      topicTitles = c.topics.map((t) => t.title.bn);
      passages = passagesFor(c.passages, { chapterId, topicId: topic?.id });
    }
    if (topic) topicTitle = topic.title.bn;
    if (!chapterId && !input.questionText && !input.conversation && !input.uploadText)
      invalid('VALIDATION');
    const res = await this.ai.note({
      kind: input.kind,
      subject: subjectName,
      chapter: chapterTitle,
      topic: topicTitle,
      topics: topicTitles,
      passages: passages.map(aiPassage),
      question_text: input.questionText,
      answer_text: input.answerText,
      conversation: input.conversation,
      upload_text: input.uploadText,
      language: input.language,
    });
    return { title: res.title, html: res.html, simulated: res.simulated };
  }

  /** English writing feedback in the apps' WritingFeedback shape. */
  async writing(
    studentId: string,
    input: { text: string; kind: string; prompt: string; minWords: number; maxWords: number },
  ) {
    await this.usage.consume(studentId, 'ai');
    const clean = input.text.trim();
    const res = await this.ai.writing({
      text: clean,
      kind: input.kind,
      prompt: input.prompt,
      min_words: input.minWords,
      max_words: input.maxWords,
    });
    return {
      words: clean.split(/\s+/).filter(Boolean).length,
      sentences: clean.split(/[.!?]+/).filter((s) => s.trim().length > 2).length,
      scores: res.scores,
      overall: res.overall,
      issues: res.issues.map((i) => ({ text: i.text, why: i.why, fix: i.fix || undefined })),
      strengths: res.strengths,
      simulated: res.simulated,
    };
  }
}
