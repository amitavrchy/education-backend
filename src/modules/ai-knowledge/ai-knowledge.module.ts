import { Module } from '@nestjs/common';
import { VECTOR_STORE } from './interfaces/vector-store.interface.js';
import { KnowledgeRetrievalService } from './services/knowledge-retrieval.service.js';
import { NoopVectorStore } from './services/noop-vector-store.js';

/** Curriculum knowledge base: chunking, embeddings, vector search. */
@Module({
  providers: [KnowledgeRetrievalService, { provide: VECTOR_STORE, useClass: NoopVectorStore }],
  exports: [KnowledgeRetrievalService, VECTOR_STORE],
})
export class AiKnowledgeModule {}
