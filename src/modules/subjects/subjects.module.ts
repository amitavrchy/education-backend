import { Module } from '@nestjs/common';
import { SubjectsService } from './subjects.service.js';

@Module({
  providers: [SubjectsService],
  exports: [SubjectsService],
})
export class SubjectsModule {}
