import { Injectable } from '@nestjs/common';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import { nowIso } from '../../common/utils/dates.js';
import type { CurriculumVersion } from '../../contracts/curriculum.js';
import type {
  AnswerWarning,
  ChatMessage,
  Conversation,
  SourcePassage,
  TutorContext,
} from '../../contracts/learning.js';
import type { Question } from '../../contracts/question.js';
import { citation, relatedQuestions, retrieve, titleFrom } from '../../domain/retrieval.js';
import { AiServiceClient, aiPassage } from '../../integrations/ai-service/ai-service.client.js';
import { UsageService } from '../billing/usage.service.js';
import { ProgressService } from '../progress/progress.service.js';
import { RecordStoreService, type Entity, type Where } from '../records/record-store.service.js';

const PASSAGES = { collection: 'kbPassages', scope: '' };
const NEW_TITLE = 'নতুন কথোপকথন';
const CACHE_MS = 60_000;

export interface TutorReply {
  user?: ChatMessage;
  assistant: ChatMessage;
}

type Generated = Pick<
  ChatMessage,
  | 'content'
  | 'citations'
  | 'grounding'
  | 'confidence'
  | 'followUps'
  | 'relatedQuestionIds'
  | 'warnings'
  | 'simulated'
>;

const WARNINGS = new Set<AnswerWarning>([
  'low_confidence',
  'missing_kb',
  'conflicting_sources',
  'old_curriculum',
  'integrity',
  'safety',
]);

/**
 * AI tutor (docs/api/AI_TUTOR_CONTRACT.md). Pipeline: quota → retrieval over ingested KB passages
 * → the AI service (`education-ai`) writes the answer, follow-ups and warnings from those passages.
 * Citations are the retrieved passages the model actually cited. No AI runs in this backend.
 */
@Injectable()
export class TutorService {
  private cache?: { at: number; passages: SourcePassage[]; archived: string[] };

  constructor(
    private readonly store: RecordStoreService,
    private readonly usage: UsageService,
    private readonly progress: ProgressService,
    private readonly aiService: AiServiceClient,
  ) {}

  private async knowledge() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    const passages = await this.store.all<SourcePassage & Entity>(PASSAGES);
    const versions = await this.store.all<CurriculumVersion & Entity>({
      collection: 'curriculumVersions',
      scope: '',
    });
    this.cache = {
      at: Date.now(),
      passages,
      archived: versions.filter((v) => v.status === 'archived').map((v) => v.id),
    };
    return this.cache;
  }

  /** Admin query simulator: the same retriever the tutor uses. */
  async simulateQuery(query: string, context: Partial<TutorContext>) {
    const { passages } = await this.knowledge();
    const ctx: TutorContext = {
      levelCode: 'SSC',
      grade: 10,
      curriculumVersionId: 'cv-2012r',
      language: 'bn',
      mode: 'simple',
      ...context,
    };
    return retrieve(query, ctx, passages).map((r) => ({ passage: r.p, score: r.score }));
  }

  private conversations(studentId: string) {
    return { collection: 'conversations', scope: studentId };
  }

  private messages(studentId: string) {
    return { collection: 'messages', scope: studentId };
  }

  private async generate(
    context: TutorContext,
    query: string,
    history: ChatMessage[],
  ): Promise<Generated> {
    const { passages, archived } = await this.knowledge();
    const found = retrieve(query, context, passages);
    const filters: Where = context.subjectId
      ? { subjectId: [context.subjectId], status: ['published'] }
      : { levelCode: [context.levelCode], status: ['published'] };
    const questions = await this.store.all<Question & Entity>(
      { collection: 'questions', scope: '' },
      'all',
      { filters },
    );
    const res = await this.aiService.tutorRespond({
      query,
      context: {
        level_code: context.levelCode,
        grade: context.grade,
        subject: context.subjectId,
        chapter: context.chapterId,
        mode: context.mode,
        language: context.language,
      },
      passages: found.map((r) => aiPassage(r.p)),
      history: history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    });
    const cited = new Set(res.cited_passage_ids);
    const used = found.filter((r) => cited.has(r.p.id));
    const warnings = res.warnings.filter((w): w is AnswerWarning =>
      WARNINGS.has(w as AnswerWarning),
    );
    if (
      used.some((r) => archived.includes(r.p.curriculumVersionId)) &&
      !warnings.includes('old_curriculum')
    )
      warnings.push('old_curriculum');
    return {
      content: res.content,
      citations: used.map((r) => citation(r.p, r.score)),
      grounding:
        used.length === 0 ? 'general' : used.length === found.length ? 'verified' : 'partial',
      confidence: res.confidence,
      followUps: res.follow_ups,
      relatedQuestionIds: relatedQuestions(
        questions,
        context,
        used.map((r) => r.p),
      ),
      warnings,
      simulated: res.simulated,
    };
  }

  async send(
    studentId: string,
    conversationId: string,
    content: string,
    replaceFromMessageId?: string,
  ): Promise<TutorReply> {
    const convo =
      (await this.store.find<Conversation & Entity>(
        this.conversations(studentId),
        conversationId,
      )) ?? notFound('Conversation');
    await this.usage.consume(studentId, 'ai');
    const msgRef = this.messages(studentId);
    let history = await this.store.all<ChatMessage & Entity>(
      msgRef,
      [{ conversationId: [conversationId] }],
      { sortBy: 'createdAt', sortOrder: 'asc' },
    );
    if (replaceFromMessageId) {
      // Edit: drop the edited message and everything after it, then resend.
      const idx = history.findIndex((m) => m.id === replaceFromMessageId);
      if (idx === -1) notFound('ChatMessage');
      await this.store.remove(
        msgRef,
        history.slice(idx).map((m) => m.id),
      );
      history = history.slice(0, idx);
    }
    const now = nowIso();
    const user: ChatMessage = {
      id: RecordStoreService.newId('msg'),
      conversationId,
      role: 'user',
      content,
      createdAt: now,
      editedAt: replaceFromMessageId ? now : undefined,
      status: 'complete',
      citations: [],
      followUps: [],
      relatedQuestionIds: [],
      warnings: [],
      simulated: false,
    };
    const reply = await this.generate(convo.context, content, history);
    const assistant: ChatMessage = {
      ...reply,
      id: RecordStoreService.newId('msg'),
      conversationId,
      role: 'assistant',
      createdAt: new Date(Date.now() + 1).toISOString(),
      status: 'complete',
      mode: convo.context.mode,
    };
    await this.store.insertMany(msgRef, [user, assistant] as (ChatMessage & Entity)[]);
    await this.store.replace(this.conversations(studentId), {
      ...convo,
      title: history.length === 0 && convo.title === NEW_TITLE ? titleFrom(content) : convo.title,
      messageCount: history.length + 2,
      lastMessagePreview: content.slice(0, 120),
      updatedAt: nowIso(),
    });
    await this.progress.logActivity(studentId, {
      kind: 'tutor',
      minutes: 2,
      label: 'AI টিউটর সেশন',
      xp: 5,
    });
    const asked = await this.store.count(msgRef, { role: ['user'] });
    if (asked >= 20) await this.progress.grantBadge(studentId, 'tutor-curious');
    return { user, assistant };
  }

  async regenerate(studentId: string, assistantId: string): Promise<ChatMessage> {
    const msgRef = this.messages(studentId);
    const target =
      (await this.store.find<ChatMessage & Entity>(msgRef, assistantId)) ?? notFound('ChatMessage');
    if (target.role !== 'assistant') invalid('VALIDATION');
    const convo =
      (await this.store.find<Conversation & Entity>(
        this.conversations(studentId),
        target.conversationId,
      )) ?? notFound('Conversation');
    await this.usage.consume(studentId, 'ai');
    const msgs = await this.store.all<ChatMessage & Entity>(
      msgRef,
      [{ conversationId: [target.conversationId] }],
      { sortBy: 'createdAt', sortOrder: 'asc' },
    );
    const idx = msgs.findIndex((m) => m.id === assistantId);
    const prompt = [...msgs.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (!prompt) invalid('VALIDATION');
    const reply = await this.generate(
      convo.context,
      prompt.content,
      msgs.slice(0, Math.max(0, idx - 1)),
    );
    const { feedback: _f, ...rest } = target;
    const updated = { ...rest, ...reply, createdAt: nowIso() } as ChatMessage & Entity;
    await this.store.replace(msgRef, updated);
    return updated;
  }

  async report(studentId: string, messageId: string, reason: string) {
    const msgRef = this.messages(studentId);
    const msg =
      (await this.store.find<ChatMessage & Entity>(msgRef, messageId)) ?? notFound('ChatMessage');
    await this.store.insert(
      { collection: 'contentReports', scope: '' },
      {
        id: RecordStoreService.newId('rep'),
        kind: 'ai_answer',
        refId: msg.id,
        reason: reason.slice(0, 300),
        details: msg.content.slice(0, 200),
        reporterId: studentId,
        status: 'open',
        createdAt: nowIso(),
      },
    );
    await this.store.insert(
      { collection: 'aiLogs', scope: '' },
      {
        id: RecordStoreService.newId('ail'),
        at: nowIso(),
        kind: 'feedback_negative',
        query: msg.content.slice(0, 120),
        detail: reason.slice(0, 300),
        status: 'open',
      },
    );
    const updated = { ...msg, reported: true };
    await this.store.replace(msgRef, updated);
    return updated;
  }
}
