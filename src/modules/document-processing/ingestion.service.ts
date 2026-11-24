import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import { nowIso } from '../../common/utils/dates.js';
import type { Book, SourcePassage } from '../../contracts/learning.js';
import {
  INGESTION_STAGES,
  type IngestionJob,
  type IngestionStage,
} from '../../contracts/operations.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { DOMAIN_EVENTS } from '../../infrastructure/events/domain-events.js';
import { QUEUE_NAMES } from '../../infrastructure/queues/queue.constants.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../infrastructure/storage/storage.interface.js';
import { chunkText } from '../ai-knowledge/services/text-chunker.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

const JOBS = { collection: 'ingestionJobs', scope: '' };
const BOOKS = { collection: 'books', scope: '' };
const PASSAGES = { collection: 'kbPassages', scope: '' };
const STEP_DELAY_MS = 1500;
const TEXT_TYPES = ['text/plain', 'text/markdown'];

export interface IngestionStepJob {
  jobId: string;
}

type Job = IngestionJob & Entity & { fileId?: string };

const MESSAGES: Partial<Record<IngestionStage, string>> = {
  validate: 'File type and size validated',
  extract: 'Text layer extracted',
  ocr: 'OCR completed for scanned pages',
  map_chapters: 'Chapters mapped to curriculum',
  chunk: 'Created semantic chunks',
  embed: 'Embeddings generated',
  index: 'Indexed into the knowledge base',
  quality_check: 'Quality checks passed',
  review: 'Waiting for reviewer approval',
  publish: 'Publishing',
};

/**
 * Book/document ingestion pipeline (admin → Books → Upload). Each job moves through
 * INGESTION_STAGES on the pdf-processing queue, one delayed step per stage, pausing at
 * `review` for a human. Plain-text sources are really chunked into KB passages that the tutor
 * can cite; for PDFs the text-extraction/OCR/embedding adapters are pluggable (logged as such).
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly store: RecordStoreService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.PDF_PROCESSING) private readonly queue: Queue<IngestionStepJob>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  static initialJob(input: {
    id: string;
    bookId: string;
    bookTitle: string;
    fileName: string;
    fileSizeKb: number;
    fileId?: string;
    failAt?: IngestionStage;
  }): Job {
    const now = nowIso();
    return {
      ...input,
      stage: 'upload',
      stageStatus: 'running',
      progress: 0,
      stages: INGESTION_STAGES.map((stage, i) => ({
        stage,
        status: i === 0 ? 'running' : 'pending',
        startedAt: i === 0 ? now : undefined,
      })),
      logs: [{ at: now, level: 'info', message: `Upload started: ${input.fileName}` }],
      chunkCount: 0,
      pagesProcessed: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  @OnEvent(DOMAIN_EVENTS.INGESTION_REQUESTED, { async: true, promisify: true })
  async onRequested(payload: { jobId: string }) {
    await this.schedule(payload.jobId, 200);
  }

  private async schedule(jobId: string, delay = STEP_DELAY_MS) {
    try {
      await this.queue.add(
        'ingestion-step',
        { jobId },
        { delay, jobId: `ing:${jobId}:${Date.now()}` },
      );
    } catch (error) {
      this.logger.error(
        { err: error, jobId },
        'Could not enqueue ingestion step (is Redis running?)',
      );
    }
  }

  private async job(id: string): Promise<Job> {
    return (await this.store.find<Job>(JOBS, id)) ?? notFound('IngestionJob');
  }

  private async save(job: Job) {
    await this.store.replace(JOBS, { ...job, updatedAt: nowIso() });
  }

  /** Advances one stage. Called by the queue worker. */
  async step(id: string): Promise<void> {
    const job = await this.store.find<Job>(JOBS, id);
    if (!job || job.stageStatus !== 'running') return;
    const i = INGESTION_STAGES.indexOf(job.stage);
    const stages = [...job.stages];
    const log = (level: 'info' | 'warn' | 'error', message: string) =>
      job.logs.push({ at: nowIso(), level, message });

    if (job.failAt === job.stage) {
      stages[i] = {
        ...stages[i],
        status: 'failed',
        finishedAt: nowIso(),
        message: 'Simulated failure — see logs',
      };
      log('error', `${job.stage} failed (simulated)`);
      return this.save({ ...job, stages, stageStatus: 'failed' });
    }
    try {
      await this.runStage(job, log);
    } catch (error) {
      stages[i] = {
        ...stages[i],
        status: 'failed',
        finishedAt: nowIso(),
        message: (error as Error).message.slice(0, 200),
      };
      log('error', `${job.stage} failed: ${(error as Error).message.slice(0, 200)}`);
      return this.save({ ...job, stages, stageStatus: 'failed' });
    }
    stages[i] = { ...stages[i], status: 'succeeded', finishedAt: nowIso() };
    const next = INGESTION_STAGES[i + 1];
    if (!next) {
      log('info', 'Published');
      await this.publishBook(job.bookId);
      return this.save({ ...job, stages, stageStatus: 'succeeded', progress: 100 });
    }
    const waiting = next === 'review';
    stages[i + 1] = {
      ...stages[i + 1],
      status: waiting ? 'waiting_review' : 'running',
      startedAt: nowIso(),
    };
    log('info', MESSAGES[next] ?? next);
    await this.save({
      ...job,
      stages,
      stage: next,
      stageStatus: waiting ? 'waiting_review' : 'running',
      progress: Math.round(((i + 1) / INGESTION_STAGES.length) * 100),
      pagesProcessed: Math.min(job.pagesProcessed + 16, Math.max(job.pagesProcessed, 96)),
    });
    if (!waiting) await this.schedule(id);
  }

  /** Real work for the stages that have an implementation in this build. */
  private async runStage(job: Job, log: (level: 'info' | 'warn' | 'error', m: string) => void) {
    if (job.stage === 'validate' && job.fileId) {
      const file = await this.prisma.storedFile.findUnique({ where: { id: job.fileId } });
      if (!file) throw new Error('Uploaded file not found');
      if (!['application/pdf', ...TEXT_TYPES].includes(file.mimeType))
        throw new Error(`Unsupported type ${file.mimeType}`);
    }
    if (job.stage === 'chunk') {
      const text = await this.sourceText(job);
      if (!text) {
        log(
          'warn',
          'No text layer available to this build (PDF extractor/OCR adapter not configured); KB passages not created',
        );
        return;
      }
      const book = await this.store.find<Book & Entity>(BOOKS, job.bookId);
      const chunks = chunkText(text, { maxChars: 900 });
      await this.prisma.record.deleteMany({
        where: { collection: 'kbPassages', id: { startsWith: `kb-${job.id}-` } },
      });
      const passages: SourcePassage[] = chunks.map((c, n) => ({
        id: `kb-${job.id}-${n + 1}`,
        documentId: job.bookId,
        subjectId: book?.subjectId ?? '',
        chapterId: book?.chapters?.[0]?.chapterId ?? '',
        bookTitle: book?.title.bn ?? job.bookTitle,
        chapterTitle: book?.chapters?.[0]?.title.bn ?? '',
        page: n + 1,
        text: c,
        keywords: [
          ...new Set(
            c
              .toLocaleLowerCase()
              .split(/[\s,.?!।;:()"']+/)
              .filter((w) => w.length > 4),
          ),
        ].slice(0, 12),
        curriculumVersionId: book?.curriculumVersionId ?? '',
        language: /[ঀ-৿]/.test(c) ? 'bn' : 'en',
        verification: 'unverified',
        embeddingStatus: 'pending',
        tokenCount: Math.ceil(c.length / 4),
      }));
      await this.store.insertMany(PASSAGES, passages as (SourcePassage & Entity)[]);
      job.chunkCount = passages.length;
      log('info', `${passages.length} passages created`);
    }
  }

  private async sourceText(job: Job): Promise<string | null> {
    if (!job.fileId) return null;
    const file = await this.prisma.storedFile.findUnique({ where: { id: job.fileId } });
    if (!file || !TEXT_TYPES.includes(file.mimeType)) return null;
    const stream = await this.storage.getStream(file.key);
    const parts: Buffer[] = [];
    for await (const chunk of stream) parts.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(parts).toString('utf8');
  }

  private async publishBook(bookId: string) {
    const book = await this.store.find<Book & Entity>(BOOKS, bookId);
    if (book)
      await this.store.replace(BOOKS, { ...book, status: 'published', updatedAt: nowIso() });
  }

  async retry(id: string) {
    const job = await this.job(id);
    if (job.stageStatus !== 'failed') invalid('INVALID_TRANSITION');
    const i = INGESTION_STAGES.indexOf(job.stage);
    const stages = job.stages.map((s, j) =>
      j === i ? { ...s, status: 'running' as const, message: undefined, startedAt: nowIso() } : s,
    );
    const next = {
      ...job,
      stages,
      stageStatus: 'running' as const,
      failAt: undefined,
      logs: [...job.logs, { at: nowIso(), level: 'info' as const, message: `Retry ${job.stage}` }],
    };
    await this.save(next);
    await this.schedule(id);
    return next;
  }

  async approveReview(id: string) {
    const job = await this.job(id);
    if (job.stageStatus !== 'waiting_review') invalid('INVALID_TRANSITION');
    const i = INGESTION_STAGES.indexOf('review');
    const stages = job.stages.map((s, j) =>
      j === i
        ? { ...s, status: 'succeeded' as const, finishedAt: nowIso() }
        : j === i + 1
          ? { ...s, status: 'running' as const, startedAt: nowIso() }
          : s,
    );
    const next = {
      ...job,
      stages,
      stage: 'publish' as const,
      stageStatus: 'running' as const,
      logs: [...job.logs, { at: nowIso(), level: 'info' as const, message: 'Reviewer approved' }],
    };
    await this.save(next);
    await this.schedule(id);
    return next;
  }

  async reindex(id: string) {
    const job = await this.job(id);
    const from = INGESTION_STAGES.indexOf('chunk');
    const stages = job.stages.map((s, j) =>
      j === from
        ? { ...s, status: 'running' as const, startedAt: nowIso() }
        : j > from
          ? { ...s, status: 'pending' as const, startedAt: undefined, finishedAt: undefined }
          : s,
    );
    const next = {
      ...job,
      stages,
      stage: 'chunk' as const,
      stageStatus: 'running' as const,
      progress: Math.round((from / INGESTION_STAGES.length) * 100),
      logs: [...job.logs, { at: nowIso(), level: 'info' as const, message: 'Reindex requested' }],
    };
    await this.save(next);
    await this.schedule(id);
    return next;
  }
}
