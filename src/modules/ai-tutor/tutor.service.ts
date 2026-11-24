import { Inject, Injectable, Logger } from '@nestjs/common';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import { nowIso } from '../../common/utils/dates.js';
import type { CurriculumVersion } from '../../contracts/curriculum.js';
import type {
  ChatMessage,
  Conversation,
  SourcePassage,
  TutorContext,
} from '../../contracts/learning.js';
import type { Question } from '../../contracts/question.js';
import { integrationsConfig, type IntegrationsConfig } from '../../config/index.js';
import {
  retrieve,
  runEngine,
  titleFrom,
  type EngineOutput,
} from '../../domain/tutor/tutor-engine.js';
import {
  CHAT_MODEL_PROVIDER,
  type ChatModelProvider,
} from '../../integrations/ai-providers/ai-provider.interfaces.js';
import { UsageService } from '../billing/usage.service.js';
import { ProgressService } from '../progress/progress.service.js';
import { RecordStoreService, type Entity, type Where } from '../records/record-store.service.js';
import { TUTOR_SYSTEM_PROMPT } from './constants/tutor-prompts.js';

const PASSAGES = { collection: 'kbPassages', scope: '' };
const NEW_TITLE = 'নতুন কথোপকথন';
const CACHE_MS = 60_000;

export interface TutorReply {
  user?: ChatMessage;
  assistant: ChatMessage;
}

/**
 * AI tutor (docs/api/AI_TUTOR_CONTRACT.md). Pipeline: quota → safety → retrieval over ingested
 * KB passages → grounding/confidence → answer. With a real AI provider the answer text is
 * written by the model from the retrieved passages; otherwise the deterministic local engine
 * composes it (marked `simulated: true`). Citations always point to real passage ids.
 */
@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);
  private cache?: { at: number; passages: SourcePassage[]; archived: string[] };

  constructor(
    private readonly store: RecordStoreService,
    private readonly usage: UsageService,
    private readonly progress: ProgressService,
    @Inject(CHAT_MODEL_PROVIDER) private readonly model: ChatModelProvider,
    @Inject(integrationsConfig.KEY) private readonly config: IntegrationsConfig,
  ) {}

  private get usesModel() {
    return this.config.ai.provider !== 'none' && this.config.ai.provider !== 'mock';
  }

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
    variant: number,
  ): Promise<EngineOutput & { simulated: boolean }> {
    const { passages, archived } = await this.knowledge();
    const filters: Where = context.subjectId
      ? { subjectId: [context.subjectId], status: ['published'] }
      : { levelCode: [context.levelCode], status: ['published'] };
    const questions = await this.store.all<Question & Entity>(
      { collection: 'questions', scope: '' },
      'all',
      { filters },
    );
    const out = runEngine({
      query,
      context,
      passages,
      questions,
      history,
      archivedVersionIds: archived,
      variant,
    });
    if (!this.usesModel || out.warnings.includes('safety')) return { ...out, simulated: true };
    try {
      const sources = out.citations
        .map((c, i) => `[${i + 1}] ${c.bookTitle} — ${c.chapterTitle}, p.${c.page}: ${c.excerpt}`)
        .join('\n');
      const res = await this.model.complete({
        messages: [
          {
            role: 'system',
            content: `${TUTOR_SYSTEM_PROMPT}\nTeaching mode: ${context.mode}. Language: ${context.language}. Level: ${context.levelCode} grade ${context.grade}.\nUse ONLY these textbook sources; if they don't cover the question, say so.\n${sources || '(no sources found)'}`,
          },
          ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: query },
        ],
        temperature: 0.3,
      });
      return { ...out, content: res.content, simulated: false };
    } catch (error) {
      this.logger.warn({ err: error }, 'AI provider failed; falling back to the local engine');
      return { ...out, simulated: true };
    }
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
    const reply = await this.generate(convo.context, content, history, 0);
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
      1 + Math.floor(Math.random() * 3),
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
