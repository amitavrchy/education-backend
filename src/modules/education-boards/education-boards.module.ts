import { Module } from '@nestjs/common';
import { EducationBoardsService } from './education-boards.service.js';

@Module({
  providers: [EducationBoardsService],
  exports: [EducationBoardsService],
})
export class EducationBoardsModule {}
