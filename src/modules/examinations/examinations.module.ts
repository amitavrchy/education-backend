import { Module } from '@nestjs/common';
import { ExaminationsService } from './examinations.service.js';

@Module({
  providers: [ExaminationsService],
  exports: [ExaminationsService],
})
export class ExaminationsModule {}
