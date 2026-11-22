import { Module } from '@nestjs/common';
import { CareerGuidanceService } from './career-guidance.service.js';

@Module({
  providers: [CareerGuidanceService],
  exports: [CareerGuidanceService],
})
export class CareerGuidanceModule {}
