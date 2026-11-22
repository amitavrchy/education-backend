import { Module } from '@nestjs/common';
import { SubmissionsService } from './submissions.service.js';

@Module({
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
