import { Module } from '@nestjs/common';
import { StudyPlansService } from './study-plans.service.js';

@Module({
  providers: [StudyPlansService],
  exports: [StudyPlansService],
})
export class StudyPlansModule {}
