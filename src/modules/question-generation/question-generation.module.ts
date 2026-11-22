import { Module } from '@nestjs/common';
import { QuestionGenerationService } from './question-generation.service.js';

@Module({
  providers: [QuestionGenerationService],
  exports: [QuestionGenerationService],
})
export class QuestionGenerationModule {}
