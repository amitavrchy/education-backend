import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { RequestWithUser } from '../../common/interfaces/authenticated-user.interface.js';
import { appConfig, type AppConfig } from '../../config/index.js';

/**
 * Global rate limiting. Imported after AuthModule so `request.user` is set and
 * signed-in users get their own budget; anonymous traffic is counted per IP.
 * Counters are in memory: switch to a Redis storage before running several instances.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: config.throttle.ttl, limit: config.throttle.limit }],
        getTracker: (req: Record<string, unknown>) => {
          const request = req as unknown as RequestWithUser;
          return request.user ? `user:${request.user.id}` : `ip:${request.ip}`;
        },
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
