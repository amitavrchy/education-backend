import { Inject, Injectable } from '@nestjs/common';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from '../../../integrations/ai-providers/ai-provider.interfaces.js';
import {
  VECTOR_STORE,
  type VectorSearchHit,
  type VectorSearchQuery,
  type VectorStore,
} from '../interfaces/vector-store.interface.js';

/** Knowledge retrieval: query text → embedding → vector search over curriculum content. */
@Injectable()
export class KnowledgeRetrievalService {
  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
  ) {}

  async retrieve(
    query: string,
    options: { topK?: number; filter?: VectorSearchQuery['filter'] } = {},
  ): Promise<VectorSearchHit[]> {
    const [embedding] = await this.embeddings.embed([query]);
    return this.vectorStore.search({
      embedding,
      topK: options.topK ?? 5,
      filter: options.filter,
      minScore: 0.2,
    });
  }
}
