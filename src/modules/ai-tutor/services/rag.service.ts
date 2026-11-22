import { Injectable } from '@nestjs/common';
import { KnowledgeRetrievalService } from '../../ai-knowledge/services/knowledge-retrieval.service.js';
import { AiChatService } from './ai-chat.service.js';

export interface RagAnswer {
  answer: string;
  model: string;
  sources: { documentId: string; chapterId?: string; page?: number; score: number }[];
}

/** Retrieval-augmented generation: retrieve textbook context, then answer with citations. */
@Injectable()
export class RagService {
  constructor(
    private readonly retrieval: KnowledgeRetrievalService,
    private readonly chat: AiChatService,
  ) {}

  async answer(
    question: string,
    options: { userRef: string; subjectId?: string; chapterId?: string },
  ): Promise<RagAnswer> {
    const hits = await this.retrieval.retrieve(question, {
      filter: { subjectId: options.subjectId, chapterId: options.chapterId },
    });

    const context = hits.length
      ? hits.map((hit, index) => `[${index + 1}] ${hit.chunk.text}`).join('\n\n')
      : 'No textbook context was found for this question.';

    const result = await this.chat.complete(
      [
        {
          role: 'user',
          content: `Textbook context:\n${context}\n\nStudent question:\n${question}`,
        },
      ],
      options.userRef,
    );

    return {
      answer: result.content,
      model: result.model,
      sources: hits.map((hit) => ({
        documentId: hit.chunk.documentId,
        chapterId: hit.chunk.metadata.chapterId,
        page: hit.chunk.metadata.page,
        score: hit.score,
      })),
    };
  }
}
