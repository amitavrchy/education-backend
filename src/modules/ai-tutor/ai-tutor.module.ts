import { Module } from '@nestjs/common';
import { TutorController } from './tutor.controller.js';
import { TutorService } from './tutor.service.js';

/** Tutor conversations: retrieval and storage here, answers from the AI service. */
@Module({
  controllers: [TutorController],
  providers: [TutorService],
  exports: [TutorService],
})
export class AiTutorModule {}
