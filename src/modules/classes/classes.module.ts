import { Module } from '@nestjs/common';
import { ClassesService } from './classes.service.js';

@Module({
  providers: [ClassesService],
  exports: [ClassesService],
})
export class ClassesModule {}
