import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import type { TutorChatDto } from './dto/tutor-chat.dto.js';
import { RagService } from './services/rag.service.js';

/**
 * AI tutor use cases. Conversation history, usage quotas per subscription and
 * content moderation of prompts/answers are planned here.
 */
@Injectable()
export class AiTutorService {
  constructor(private readonly rag: RagService) {}

  ask(user: AuthenticatedUser, dto: TutorChatDto) {
    return this.rag.answer(dto.message, {
      userRef: user.id,
      subjectId: dto.subjectId,
      chapterId: dto.chapterId,
    });
  }
}
