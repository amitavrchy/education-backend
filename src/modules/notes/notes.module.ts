import { Module } from '@nestjs/common';
import { NotesService } from './notes.service.js';

@Module({
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
