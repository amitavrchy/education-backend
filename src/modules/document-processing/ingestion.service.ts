import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { PDFDocument } from 'pdf-lib';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import { nowIso } from '../../common/utils/dates.js';
import type { Chapter, Topic } from '../../contracts/curriculum.js';
import type { Book, BookChapterRef, SourcePassage } from '../../contracts/learning.js';
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
import {
  AiServiceClient,
  retryRateLimited,
  type DocumentType,
  type ExtractedPage,
} from '../../integrations/ai-service/ai-service.client.js';
import {
  BOOK_PAGES,
  KB_VECTORS,
  KnowledgeService,
  pageId,
  type StoredBookPage,
} from '../knowledge/knowledge.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';
import { chunkText } from './text-chunker.js';

const JOBS = { collection: 'ingestionJobs', scope: '' };
const BOOKS = { collection: 'books', scope: '' };
const PASSAGES = { collection: 'kbPassages', scope: '' };
const STEP_DELAY_MS = 800;
/** PDF pages sent to the AI service per request, and requests in flight at once. */
const PDF_BATCH = 4;
const PDF_PARALLEL = 2;

export const INGESTIBLE_TYPES: DocumentType[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export interface IngestionStepJob {
  jobId: string;
}

type Job = IngestionJob &
  Entity & {
    fileId?: string;
    mimeType?: string;
    pageCount?: number;
    method?: 'vision' | 'text';
    model?: string;
    detectedChapters?: { title: string; page: number }[];
    /** Applied on publish (e.g. an official textbook's licence). */
    bookPatch?: Partial<Pick<Book, 'license' | 'provenance' | 'publisher' | 'edition'>>;
  };

type Log = (level: 'info' | 'warn' | 'error', message: string) => void;

const MESSAGES: Partial<Record<IngestionStage, string>> = {
  validate: 'Validating the file',
  extract: 'Reading pages',
  ocr: 'Checking OCR results',
  map_chapters: 'Mapping chapters to the curriculum',
  chunk: 'Splitting pages into passages',
  embed: 'Generating embeddings',
  index: 'Indexing into the knowledge base',
  quality_check: 'Running quality checks',
  review: 'Waiting for reviewer approval',
  publish: 'Publishing',
};

/**
 * Book/document ingestion pipeline (admin → Books → Upload). Each job moves through
 * INGESTION_STAGES on the pdf-processing queue and pauses at `review` for a human:
 * validate → extract (the AI service reads PDF pages and photos with a vision model; Word/Excel/text
 * are parsed) → map chapters (detected headings → curriculum chapters) → chunk into KB passages →
 * embed → index → quality check → review → publish. A failed stage can be retried; extraction
 * resumes after the pages already read.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly store: RecordStoreService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.PDF_PROCESSING) private readonly queue: Queue<IngestionStepJob>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly ai: AiServiceClient,
    private readonly knowledge: KnowledgeService,
  ) {}

  static initialJob(input: {
    id: string;
    bookId: string;
    bookTitle: string;
    fileName: string;
    fileSizeKb: number;
    fileId?: string;
    mimeType?: string;
    bookPatch?: Job['bookPatch'];
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
      logs: [{ at: now, level: 'info', message: `Upload received: ${input.fileName}` }],
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

  /** Runs the current stage, then queues the next one. Called by the queue worker. */
  async step(id: string): Promise<void> {
    const job = await this.store.find<Job>(JOBS, id);
    if (!job || job.stageStatus !== 'running') return;
    const i = INGESTION_STAGES.indexOf(job.stage);
    const log: Log = (level, message) => job.logs.push({ at: nowIso(), level, message });
    try {
      await this.runStage(job, log);
    } catch (error) {
      const message = (error as Error).message.slice(0, 300);
      const stages = [...job.stages];
      stages[i] = { ...stages[i], status: 'failed', finishedAt: nowIso(), message };
      log('error', `${job.stage} failed: ${message}`);
      this.logger.warn({ jobId: id, stage: job.stage, err: message }, 'Ingestion stage failed');
      return this.save({ ...job, stages, stageStatus: 'failed' });
    }
    const stages = [...job.stages];
    stages[i] = { ...stages[i], status: 'succeeded', finishedAt: nowIso() };
    const next = INGESTION_STAGES[i + 1];
    if (!next) {
      log('info', 'Published');
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
      progress: Math.max(job.progress, Math.round(((i + 1) / INGESTION_STAGES.length) * 100)),
    });
    if (!waiting) await this.schedule(id);
  }

  private async runStage(job: Job, log: Log) {
    switch (job.stage) {
      case 'validate':
        return this.validate(job, log);
      case 'extract':
        return this.extract(job, log);
      case 'ocr':
        return this.ocr(job, log);
      case 'map_chapters':
        return this.mapChapters(job, log);
      case 'chunk':
        return this.chunk(job, log);
      case 'embed':
        return this.embed(job, log);
      case 'index':
        return this.index(job, log);
      case 'quality_check':
        return this.qualityCheck(job, log);
      case 'publish':
        return this.publish(job, log);
      default:
        return;
    }
  }

  // ── Stages ─────────────────────────────────────────────────────────────

  private async file(job: Job) {
    if (!job.fileId) throw new Error('This job has no uploaded file');
    const file = await this.prisma.storedFile.findUnique({ where: { id: job.fileId } });
    if (!file) throw new Error('Uploaded file not found');
    return file;
  }

  private async bytes(key: string): Promise<Buffer> {
    const stream = await this.storage.getStream(key);
    const parts: Buffer[] = [];
    for await (const chunk of stream) parts.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(parts);
  }

  private async validate(job: Job, log: Log) {
    const file = await this.file(job);
    if (!INGESTIBLE_TYPES.includes(file.mimeType as DocumentType))
      throw new Error(`Unsupported file type ${file.mimeType}`);
    job.mimeType = file.mimeType;
    if (file.mimeType === 'application/pdf') {
      const pdf = await PDFDocument.load(await this.bytes(file.key), {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      job.pageCount = pdf.getPageCount();
      if (!job.pageCount) throw new Error('The PDF has no pages');
      log('info', `PDF with ${job.pageCount} pages (${job.fileSizeKb} KB)`);
    } else {
      log('info', `${file.mimeType} file (${job.fileSizeKb} KB)`);
    }
  }

  private async savePages(job: Job, pages: ExtractedPage[]) {
    const now = nowIso();
    const rows: StoredBookPage[] = pages.map((p) => ({
      id: pageId(job.bookId, p.page),
      bookId: job.bookId,
      jobId: job.id,
      pageNumber: p.page,
      heading: p.heading.slice(0, 300),
      body: p.text,
      createdAt: now,
    }));
    await this.store.remove(
      BOOK_PAGES,
      rows.map((r) => r.id),
    );
    await this.store.insertMany(BOOK_PAGES, rows as (StoredBookPage & Entity)[]);
  }

  private async extract(job: Job, log: Log) {
    const file = await this.file(job);
    const raw = await this.bytes(file.key);
    const mime = file.mimeType as DocumentType;
    // Pages from an earlier upload of this book are replaced; pages this job already read are kept.
    const existing = await this.store.all<StoredBookPage & Entity>(BOOK_PAGES, 'all', {
      filters: { bookId: [job.bookId] },
    });
    const stale = existing.filter((p) => p.jobId !== job.id).map((p) => p.id);
    if (stale.length) await this.store.remove(BOOK_PAGES, stale);
    const done = new Set(existing.filter((p) => p.jobId === job.id).map((p) => p.pageNumber));
    const chapters = new Map((job.detectedChapters ?? []).map((c) => [c.page, c]));

    if (mime !== 'application/pdf') {
      const res = await this.ai.extract({ media_type: mime, data: raw.toString('base64') });
      await this.savePages(job, res.pages);
      for (const c of res.chapters) chapters.set(c.page, c);
      job.pageCount = res.pages.length;
      job.pagesProcessed = res.pages.length;
      job.method = res.method;
      job.model = res.model;
      job.detectedChapters = [...chapters.values()].sort((a, b) => a.page - b.page);
      log('info', `${res.pages.length} page(s) read (${res.method === 'vision' ? `vision model ${res.model}` : 'parsed'})`);
      return;
    }

    const pdf = await PDFDocument.load(raw, { ignoreEncryption: true, updateMetadata: false });
    const total = pdf.getPageCount();
    job.pageCount = total;
    const batches: number[] = [];
    for (let start = 1; start <= total; start += PDF_BATCH) {
      const pages = Array.from({ length: Math.min(PDF_BATCH, total - start + 1) }, (_, k) => start + k);
      if (pages.some((p) => !done.has(p))) batches.push(start);
    }
    if (done.size) log('info', `Resuming: ${done.size} of ${total} pages already read`);
    const base = Math.round((2 / INGESTION_STAGES.length) * 100);
    const span = Math.round((1 / INGESTION_STAGES.length) * 100);

    const failedPages = new Set<number>();
    let aborted: Error | undefined;
    const runBatch = async (start: number) => {
      const end = Math.min(total, start + PDF_BATCH - 1);
      const part = await PDFDocument.create();
      const copied = await part.copyPages(
        pdf,
        Array.from({ length: end - start + 1 }, (_, k) => start - 1 + k),
      );
      for (const page of copied) part.addPage(page);
      const bytes = Buffer.from(await part.save());
      const res = await retryRateLimited(() =>
        this.ai.extract({
          media_type: 'application/pdf',
          data: bytes.toString('base64'),
          start_page: 1,
          max_pages: end - start + 1,
          page_offset: start - 1,
        }),
      );
      if (aborted) return;
      await this.savePages(job, res.pages);
      for (const c of res.chapters) chapters.set(c.page, c);
      for (const n of res.failed_pages ?? []) failedPages.add(n);
      for (let p = start; p <= end; p++) done.add(p);
      job.method = res.method;
      job.model = res.model;
      job.pagesProcessed = done.size;
      job.detectedChapters = [...chapters.values()].sort((a, b) => a.page - b.page);
      job.progress = base + Math.round((done.size / total) * span);
      await this.save(job);
    };

    // A few batches in flight; the first error stops the others (the stage fails and can be retried).
    const queue = [...batches];
    const worker = async () => {
      for (let start = queue.shift(); start !== undefined && !aborted; start = queue.shift()) {
        try {
          await runBatch(start);
        } catch (error) {
          aborted ??= error as Error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PDF_PARALLEL, queue.length) }, worker));
    if (aborted) throw aborted;
    if (failedPages.size)
      log('warn', `${failedPages.size} page(s) could not be read and are blank: ${[...failedPages].sort((a, b) => a - b).join(', ')}`);
    log('info', `${total} pages read`);
  }

  private async ocr(job: Job, log: Log) {
    const pages = await this.jobPages(job);
    const empty = pages.filter((p) => !p.body.trim()).length;
    if (job.method === 'vision')
      log('info', `OCR by vision model (${job.model ?? 'AI'}): ${pages.length - empty} pages with text, ${empty} blank`);
    else log('info', `Text layer parsed: ${pages.length - empty} pages with text, OCR not needed`);
    if (!pages.length || empty === pages.length) throw new Error('No text could be read from the file');
  }

  private async jobPages(job: Job) {
    const pages = await this.store.all<StoredBookPage & Entity>(BOOK_PAGES, 'all', {
      filters: { bookId: [job.bookId] },
    });
    return pages.filter((p) => p.jobId === job.id).sort((a, b) => a.pageNumber - b.pageNumber);
  }

  private async mapChapters(job: Job, log: Log) {
    const book = (await this.store.find<Book & Entity>(BOOKS, job.bookId)) ?? notFound('Book');
    const pages = await this.jobPages(job);
    const total = job.pageCount ?? pages.length;
    const curriculum = await this.store.all<Chapter & Entity>(
      { collection: 'chapters', scope: '' },
      'all',
      { filters: { subjectId: [book.subjectId] } },
    );
    curriculum.sort((a, b) => a.number - b.number);
    // Chapter starts the model saw, plus top-level headings on the pages themselves.
    const headings = new Map((job.detectedChapters ?? []).map((c) => [c.page, c]));
    for (const p of pages) {
      const h1 = /^#\s+(.+)$/m.exec(p.body)?.[1];
      if (h1 && !headings.has(p.pageNumber)) headings.set(p.pageNumber, { title: h1.slice(0, 200), page: p.pageNumber });
    }
    let refs: BookChapterRef[] = [];
    if (curriculum.length && headings.size) {
      const res = await this.ai.mapChapters({
        headings: [...headings.values()].sort((a, b) => a.page - b.page).slice(0, 200),
        chapters: curriculum.map((c) => ({ id: c.id, title: `${c.title.bn} (${c.title.en})` })),
      });
      const byId = new Map(curriculum.map((c) => [c.id, c]));
      const matches = res.matches.filter((m) => m.page >= 1 && m.page <= total);
      refs = matches.map((m, k) => {
        const c = byId.get(m.chapter_id)!;
        return {
          id: `${book.id}-${c.id}`,
          title: c.title,
          chapterId: c.id,
          startPage: m.page,
          endPage: (matches[k + 1]?.page ?? total + 1) - 1,
        };
      });
    }
    if (!refs.length) {
      const first = book.chapters[0];
      refs = [
        {
          id: `${book.id}-all`,
          title: first?.title ?? book.title,
          chapterId: first?.chapterId,
          startPage: 1,
          endPage: total,
        },
      ];
      log('warn', 'No curriculum chapters recognised; the whole document is mapped to one chapter');
    } else {
      log('info', `${refs.length} of ${curriculum.length} curriculum chapters located`);
    }
    await this.store.replace(BOOKS, { ...book, chapters: refs, pageCount: total, updatedAt: nowIso() });
    this.knowledge.invalidate(book.id);
  }

  private async chunk(job: Job, log: Log) {
    const book = (await this.store.find<Book & Entity>(BOOKS, job.bookId)) ?? notFound('Book');
    const pages = await this.jobPages(job);
    const chapterIds = book.chapters.map((c) => c.chapterId).filter(Boolean) as string[];
    const topics = chapterIds.length
      ? await this.store.all<Topic & Entity>({ collection: 'topics', scope: '' }, 'all', {
          filters: { chapterId: chapterIds },
        })
      : [];
    const passages: SourcePassage[] = [];
    for (const page of pages) {
      const ref =
        book.chapters.find((c) => page.pageNumber >= c.startPage && page.pageNumber <= c.endPage) ??
        book.chapters[0];
      const chapterTopics = topics.filter((t) => t.chapterId === ref?.chapterId);
      chunkText(page.body, { maxChars: 1000 }).forEach((text, k) => {
        if (text.replace(/[\s*#_[\]]/g, '').length < 40) return;
        const topic = chapterTopics.find((t) => text.includes(t.title.bn) || (page.heading && page.heading.includes(t.title.bn)));
        passages.push({
          id: `kb-${book.id}-p${page.pageNumber}-${k + 1}`,
          documentId: book.id,
          subjectId: book.subjectId,
          chapterId: ref?.chapterId ?? '',
          topicId: topic?.id,
          bookTitle: book.title.bn,
          chapterTitle: ref?.title.bn ?? '',
          page: page.pageNumber,
          text,
          keywords: [page.heading, topic?.title.bn, topic?.title.en.toLowerCase()].filter(
            (x): x is string => !!x && x.length > 1,
          ),
          curriculumVersionId: book.curriculumVersionId,
          language: /[ঀ-৿]/.test(text) ? 'bn' : 'en',
          verification: 'unverified',
          embeddingStatus: 'pending',
          tokenCount: Math.ceil(text.length / 3),
        });
      });
    }
    if (!passages.length) throw new Error('No passages could be made from the extracted text');
    // This book's earlier passages (and the outline placeholders) are replaced by the real text.
    const old = await this.prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "records"
      WHERE "collection" = 'kbPassages' AND "scope" = '' AND "data"->>'documentId' = ${book.id}`;
    const oldIds = old.map((r) => r.id);
    await this.store.remove(PASSAGES, oldIds);
    await this.store.remove(KB_VECTORS, oldIds);
    for (let i = 0; i < passages.length; i += 500)
      await this.store.insertMany(PASSAGES, passages.slice(i, i + 500) as (SourcePassage & Entity)[]);
    job.chunkCount = passages.length;
    log('info', `${passages.length} passages created from ${pages.length} pages (${oldIds.length} old passages replaced)`);
  }

  private async bookPassages(bookId: string) {
    return this.store.all<SourcePassage & Entity>(PASSAGES, 'all', { filters: { documentId: [bookId] } });
  }

  private async embed(job: Job, log: Log) {
    const passages = await this.bookPassages(job.bookId);
    const vectors = await this.knowledge.vectors();
    const missing = passages.filter((p) => !vectors.has(p.id));
    const n = await this.knowledge.embedPassages(missing, async (done) => {
      job.logs = job.logs.filter((l) => !l.message.startsWith('Embedding '));
      log('info', `Embedding ${done}/${missing.length}`);
      await this.save(job);
    });
    await this.prisma.$executeRaw`UPDATE "records"
      SET "data" = jsonb_set("data", '{embeddingStatus}', '"embedded"')
      WHERE "collection" = 'kbPassages' AND "scope" = '' AND "data"->>'documentId' = ${job.bookId}`;
    log('info', `${n} passages embedded (${passages.length - missing.length} already had vectors)`);
  }

  private async index(job: Job, log: Log) {
    this.knowledge.invalidate(job.bookId);
    const [passages, vectors] = await Promise.all([this.bookPassages(job.bookId), this.knowledge.vectors()]);
    const indexed = passages.filter((p) => vectors.has(p.id)).length;
    log('info', `Indexed ${indexed}/${passages.length} passages for hybrid (keyword + semantic) search`);
  }

  private async qualityCheck(job: Job, log: Log) {
    const [pages, passages, book] = await Promise.all([
      this.jobPages(job),
      this.bookPassages(job.bookId),
      this.store.find<Book & Entity>(BOOKS, job.bookId),
    ]);
    const empty = pages.filter((p) => !p.body.trim()).length;
    const missing = (job.pageCount ?? pages.length) - pages.length;
    if (missing > 0) throw new Error(`${missing} pages were not read; retry the extract stage`);
    if (!passages.length) throw new Error('No passages in the knowledge base');
    if (empty / Math.max(1, pages.length) > 0.3)
      log('warn', `${empty} of ${pages.length} pages are blank — check the scan quality`);
    const short = pages.filter((p) => p.body.trim() && p.body.length < 120).length;
    log(
      'info',
      `Quality: ${pages.length} pages, ${empty} blank, ${short} very short, ${passages.length} passages, ${book?.chapters.length ?? 0} chapters`,
    );
  }

  private async publish(job: Job, log: Log) {
    const book = await this.store.find<Book & Entity>(BOOKS, job.bookId);
    if (book)
      await this.store.replace(BOOKS, {
        ...book,
        ...(job.bookPatch ?? {}),
        status: 'published',
        updatedAt: nowIso(),
      });
    await this.prisma.$executeRaw`UPDATE "records"
      SET "data" = jsonb_set("data", '{verification}', '"verified"')
      WHERE "collection" = 'kbPassages' AND "scope" = '' AND "data"->>'documentId' = ${job.bookId}`;
    this.knowledge.invalidate(job.bookId);
    log('info', 'Book published; passages marked as reviewed');
  }

  // ── Admin actions ──────────────────────────────────────────────────────

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

  /** Re-chunks and re-embeds the book from its stored pages (no new extraction). */
  async reindex(id: string) {
    const job = await this.job(id);
    if (job.stageStatus === 'running') invalid('INVALID_TRANSITION');
    const from = INGESTION_STAGES.indexOf('chunk');
    const stages = job.stages.map((s, j) =>
      j === from
        ? { ...s, status: 'running' as const, startedAt: nowIso(), message: undefined }
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
