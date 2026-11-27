import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { SourcePassage } from '../../contracts/learning.js';
import { AiServiceClient, retryRateLimited } from '../../integrations/ai-service/ai-service.client.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

export const BOOK_PAGES = { collection: 'bookPages', scope: '' };
export const KB_VECTORS = { collection: 'kbVectors', scope: '' };
const PASSAGES = { collection: 'kbPassages', scope: '' };
const EMBED_BATCH = 32;
const QUERY_CACHE = 300;
const BACKFILL_EVERY_MS = 3 * 60 * 60 * 1000;

/** A textbook page read from an uploaded book (ingestion → extract). */
export interface StoredBookPage {
  id: string;
  bookId: string;
  jobId: string;
  pageNumber: number;
  heading: string;
  body: string;
  createdAt: string;
}

/** Embedding of one KB passage (kept apart from the passage so clients never download vectors). */
export interface PassageVector {
  id: string;
  documentId: string;
  model: string;
  vector: number[];
}

export const pageId = (bookId: string, n: number) => `${bookId}-p${n}`;

/**
 * The knowledge layer the AI features retrieve from: real book pages produced by ingestion, and
 * passage embeddings (made by the AI service) for semantic search. On startup, passages that have no
 * embedding yet (e.g. the seeded knowledge base) are embedded in the background.
 */
@Injectable()
export class KnowledgeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeService.name);
  private vectorCache?: Map<string, number[]>;
  private readonly pageCache = new Map<string, StoredBookPage[]>();
  private readonly queryCache = new Map<string, number[]>();
  private backfilling = false;

  constructor(
    private readonly store: RecordStoreService,
    private readonly ai: AiServiceClient,
  ) {}

  onApplicationBootstrap() {
    if (!this.ai.enabled || process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.backfill(), 15_000).unref();
    // Passages left without vectors (e.g. a daily quota ran out) are retried every few hours.
    setInterval(() => void this.backfill(), BACKFILL_EVERY_MS).unref();
  }

  invalidate(bookId?: string) {
    this.vectorCache = undefined;
    if (bookId) this.pageCache.delete(bookId);
    else this.pageCache.clear();
  }

  // ── Book pages ─────────────────────────────────────────────────────────

  async pages(bookId: string): Promise<StoredBookPage[]> {
    const hit = this.pageCache.get(bookId);
    if (hit) return hit;
    const pages = await this.store.all<StoredBookPage & Entity>(BOOK_PAGES, 'all', {
      filters: { bookId: [bookId] },
    });
    pages.sort((a, b) => a.pageNumber - b.pageNumber);
    this.pageCache.set(bookId, pages);
    return pages;
  }

  async page(bookId: string, n: number): Promise<StoredBookPage | undefined> {
    return (await this.pages(bookId)).find((p) => p.pageNumber === n);
  }

  // ── Vectors ────────────────────────────────────────────────────────────

  async vectors(): Promise<Map<string, number[]>> {
    if (this.vectorCache) return this.vectorCache;
    const rows = await this.store.all<PassageVector & Entity>(KB_VECTORS);
    this.vectorCache = new Map(rows.map((r) => [r.id, r.vector]));
    return this.vectorCache;
  }

  /** Embedding of a search query, or null when the AI service is unavailable (keyword search still works). */
  async embedQuery(text: string): Promise<number[] | null> {
    const key = text.trim().slice(0, 500);
    if (!key || !this.ai.enabled) return null;
    const hit = this.queryCache.get(key);
    if (hit) return hit;
    try {
      const res = await this.ai.embed([key]);
      const vec = res.vectors[0];
      if (!vec?.length) return null;
      if (this.queryCache.size >= QUERY_CACHE) {
        const first = this.queryCache.keys().next().value;
        if (first !== undefined) this.queryCache.delete(first);
      }
      this.queryCache.set(key, vec);
      return vec;
    } catch (error) {
      this.logger.warn({ err: (error as Error).message }, 'Query embedding failed; keyword search only');
      return null;
    }
  }

  /** Embeds the given passages and stores their vectors. Returns how many were embedded. */
  async embedPassages(passages: SourcePassage[], onBatch?: (done: number) => Promise<void>) {
    let done = 0;
    for (let i = 0; i < passages.length; i += EMBED_BATCH) {
      const batch = passages.slice(i, i + EMBED_BATCH);
      const res = await retryRateLimited(() =>
        this.ai.embed(batch.map((p) => `${p.chapterTitle}\n${p.text}`.slice(0, 2000))),
      );
      const rows: PassageVector[] = batch
        .map((p, k) => ({
          id: p.id,
          documentId: p.documentId,
          model: res.model,
          vector: res.vectors[k],
        }))
        .filter((r) => r.vector?.length);
      await this.store.remove(
        KB_VECTORS,
        rows.map((r) => r.id),
      );
      await this.store.insertMany(KB_VECTORS, rows as (PassageVector & Entity)[]);
      done += rows.length;
      await onBatch?.(done);
    }
    this.vectorCache = undefined;
    return done;
  }

  /** Embeds every passage that has no vector yet (seeded knowledge base, imports). */
  async backfill(): Promise<number> {
    if (this.backfilling) return 0;
    this.backfilling = true;
    try {
      const [passages, vectors] = await Promise.all([
        this.store.all<SourcePassage & Entity>(PASSAGES),
        this.vectors(),
      ]);
      const missing = passages.filter((p) => !vectors.has(p.id) && p.text?.trim());
      if (!missing.length) return 0;
      this.logger.log(`Embedding ${missing.length} knowledge-base passages`);
      const n = await this.embedPassages(missing);
      this.logger.log(`Embedded ${n} passages`);
      return n;
    } catch (error) {
      this.logger.warn({ err: (error as Error).message }, 'Passage embedding backfill stopped');
      return 0;
    } finally {
      this.backfilling = false;
    }
  }

  /**
   * Re-embeds every passage of a KB collection (a subject's textbooks) in the background and
   * refreshes its counts; the collection shows `indexing` until it is done.
   */
  async reindexCollection(id: string) {
    const ref = { collection: 'kbCollections', scope: '' };
    const coll = await this.store.find<{ id: string; subjectId?: string; status: string } & Entity>(ref, id);
    if (!coll) return null;
    const passages = await this.store.all<SourcePassage & Entity>(
      PASSAGES,
      'all',
      coll.subjectId ? { filters: { subjectId: [coll.subjectId] } } : {},
    );
    const started = { ...coll, status: 'indexing', updatedAt: new Date().toISOString() };
    await this.store.replace(ref, started);
    void (async () => {
      let status = 'ready';
      try {
        await this.store.remove(KB_VECTORS, passages.map((p) => p.id));
        this.vectorCache = undefined;
        await this.embedPassages(passages);
      } catch (error) {
        status = 'failed';
        this.logger.warn({ err: (error as Error).message, id }, 'Collection reindex failed');
      }
      const fresh = (await this.store.find<Entity>(ref, id)) ?? started;
      await this.store.replace(ref, {
        ...fresh,
        status,
        chunkCount: passages.length,
        documentCount: new Set(passages.map((p) => p.documentId)).size,
        updatedAt: new Date().toISOString(),
      });
    })();
    return started;
  }
}
