import { Module } from '@nestjs/common';
import { PracticalLabService } from './practical-lab.service.js';

@Module({
  providers: [PracticalLabService],
  exports: [PracticalLabService],
})
export class PracticalLabModule {}
