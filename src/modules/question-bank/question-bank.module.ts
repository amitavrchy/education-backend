import { Module } from '@nestjs/common';
import { QuestionBankService } from './question-bank.service.js';

@Module({
  providers: [QuestionBankService],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}
