import { Module } from '@nestjs/common';
import { VideosService } from './videos.service.js';

@Module({
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
