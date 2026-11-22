import { Module } from '@nestjs/common';
import { BoardQuestionsService } from './board-questions.service.js';

@Module({
  providers: [BoardQuestionsService],
  exports: [BoardQuestionsService],
})
export class BoardQuestionsModule {}
