import { join } from 'node:path';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { envSchema } from '../../config/configuration.js';
import { PasswordHasherService } from '../../modules/auth/services/password-hasher.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { loadFrontendSeed, seedFrontendData } from './frontend-seed.js';

/**
 * First start on an empty database: loads the bundled demo data (prisma/seed-data, exported from
 * the apps' mock data) so every screen has content. Never touches a database that has any user or
 * record. Disable with SEED_ON_EMPTY=false.
 */
@Injectable()
export class SeedOnStartService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedOnStartService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    const env = envSchema.parse(process.env);
    if (!env.SEED_ON_EMPTY || env.NODE_ENV === 'test') return;
    const [users, records] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.record.count(),
    ]);
    if (users > 0 || records > 0) return;
    this.logger.log('Empty database: loading the bundled demo data…');
    const seed = loadFrontendSeed(
      join(process.cwd(), 'prisma', 'seed-data', 'frontend-seed.json.gz'),
    );
    const passwordHash = await new PasswordHasherService().hash(env.SEED_DEMO_PASSWORD);
    const res = await seedFrontendData(this.prisma, seed, { passwordHash });
    this.logger.log(
      `Seeded ${res.users} accounts, ${res.records} records, ${res.documents} documents`,
    );
  }
}
