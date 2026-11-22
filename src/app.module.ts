import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configLoaders, envSchema } from './config/index.js';
import { PrismaModule } from './database/prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { EventsModule } from './infrastructure/events/events.module.js';
import { LoggingModule } from './infrastructure/logging/logging.module.js';
import { QueuesModule } from './infrastructure/queues/queues.module.js';
import { RateLimitModule } from './infrastructure/rate-limit/rate-limit.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DomainModule } from './modules/domain.module.js';

/**
 * Root module: wiring only. Order matters for global guards —
 * AuthModule (authentication, roles, permissions) must come before RateLimitModule.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configLoaders,
      validate: (config) => {
        const result = envSchema.safeParse(config);
        if (!result.success) {
          const issues = result.error.issues.map(
            (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
          );
          throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
        }
        return config;
      },
    }),
    LoggingModule,
    PrismaModule,
    RedisModule,
    QueuesModule,
    EventsModule,
    StorageModule,
    IntegrationsModule,
    AuthModule,
    RateLimitModule,
    DomainModule,
    HealthModule,
  ],
})
export class AppModule {}
