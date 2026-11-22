import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseConfig, type DatabaseConfig } from '../../config/index.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Single PrismaClient (one connection pool) per process.
 * Connects lazily on the first query, so the API can boot while the database is still
 * starting; /api/v1/health/ready reports database availability.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(databaseConfig.KEY) config: DatabaseConfig) {
    super({
      adapter: new PrismaPg({ connectionString: config.url }),
      log: config.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }

  async isHealthy(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }
}
