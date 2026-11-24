import { Module } from '@nestjs/common';
import { AiKnowledgeModule } from '../ai-knowledge/ai-knowledge.module.js';
import { AiTutorController } from './ai-tutor.controller.js';
import { AiTutorService } from './ai-tutor.service.js';
import { AiChatService } from './services/ai-chat.service.js';
import { RagService } from './services/rag.service.js';
import { TutorController } from './tutor.controller.js';
import { TutorService } from './tutor.service.js';

@Module({
  imports: [AiKnowledgeModule],
  controllers: [AiTutorController, TutorController],
  providers: [AiTutorService, AiChatService, RagService, TutorService],
  exports: [AiChatService, TutorService],
})
export class AiTutorModule {}
