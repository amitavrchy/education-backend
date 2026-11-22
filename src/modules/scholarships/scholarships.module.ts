import { Module } from '@nestjs/common';
import { ScholarshipsService } from './scholarships.service.js';

@Module({
  providers: [ScholarshipsService],
  exports: [ScholarshipsService],
})
export class ScholarshipsModule {}
