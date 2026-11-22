export const VECTOR_STORE = Symbol('VECTOR_STORE');

/** One indexed piece of a book/document. */
export interface KnowledgeChunk {
  id: string;
  documentId: string;
  text: string;
  embedding: number[];
  /** Filters used at retrieval time (class, subject, chapter, language…). */
  metadata: {
    subjectId?: string;
    chapterId?: string;
    classId?: string;
    page?: number;
    language?: 'bn' | 'en';
  };
}

export interface VectorSearchQuery {
  embedding: number[];
  topK: number;
  filter?: Partial<KnowledgeChunk['metadata']>;
  minScore?: number;
}

export interface VectorSearchHit {
  chunk: Omit<KnowledgeChunk, 'embedding'>;
  score: number;
}

/** Vector search boundary (future: pgvector in PostgreSQL, or a managed vector DB). */
export interface VectorStore {
  readonly name: string;
  upsert(chunks: KnowledgeChunk[]): Promise<void>;
  search(query: VectorSearchQuery): Promise<VectorSearchHit[]>;
  deleteByDocument(documentId: string): Promise<void>;
}
