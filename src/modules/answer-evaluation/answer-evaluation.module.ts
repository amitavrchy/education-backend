import { Module } from '@nestjs/common';
import { AnswerEvaluationService } from './answer-evaluation.service.js';

@Module({
  providers: [AnswerEvaluationService],
  exports: [AnswerEvaluationService],
})
export class AnswerEvaluationModule {}
