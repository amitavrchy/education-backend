import { Module } from '@nestjs/common';
import { AiKnowledgeModule } from '../ai-knowledge/ai-knowledge.module.js';
import { AiTutorController } from './ai-tutor.controller.js';
import { AiTutorService } from './ai-tutor.service.js';
import { AiChatService } from './services/ai-chat.service.js';
import { RagService } from './services/rag.service.js';

@Module({
  imports: [AiKnowledgeModule],
  controllers: [AiTutorController],
  providers: [AiTutorService, AiChatService, RagService],
  exports: [AiChatService],
})
export class AiTutorModule {}
