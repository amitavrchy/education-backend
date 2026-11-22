import { Logger } from '@nestjs/common';
import type { VectorSearchHit, VectorStore } from '../interfaces/vector-store.interface.js';

/** Placeholder until a vector store is chosen: indexes nothing, retrieves nothing. */
export class NoopVectorStore implements VectorStore {
  readonly name = 'noop';
  private readonly logger = new Logger(NoopVectorStore.name);

  upsert(): Promise<void> {
    this.logger.warn('Vector store not configured; chunks were not indexed');
    return Promise.resolve();
  }

  search(): Promise<VectorSearchHit[]> {
    return Promise.resolve([]);
  }

  deleteByDocument(): Promise<void> {
    return Promise.resolve();
  }
}
