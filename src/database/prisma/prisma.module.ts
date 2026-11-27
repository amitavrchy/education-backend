import { Global, Module } from '@nestjs/common';
import { SeedOnStartService } from '../seeds/seed-on-start.service.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, SeedOnStartService],
  exports: [PrismaService],
})
export class PrismaModule {}
