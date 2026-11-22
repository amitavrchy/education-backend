import { Module } from '@nestjs/common';
import { LiveClassesService } from './live-classes.service.js';

@Module({
  providers: [LiveClassesService],
  exports: [LiveClassesService],
})
export class LiveClassesModule {}
