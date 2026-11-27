import { Global, Module } from '@nestjs/common';
import { BooksController } from './books.controller.js';
import { KbController } from './kb.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Global()
@Module({
  controllers: [BooksController, KbController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
