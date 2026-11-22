import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { redisConfig, type RedisConfig } from '../../config/index.js';
import { REDIS_CLIENT } from './redis.constants.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (config: RedisConfig) => {
        const logger = new Logger('Redis');
        const client = new Redis({
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.db,
          // Connect on first command so the API can boot before Redis is up.
          lazyConnect: true,
          maxRetriesPerRequest: 3,
        });
        client.on('error', (error: Error) => logger.warn(`Redis error: ${error.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end' && this.redis.status !== 'wait') {
      await this.redis.quit();
    }
  }
}
