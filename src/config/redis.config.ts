import { registerAs } from '@nestjs/config';
import { envSchema } from './configuration.js';

export const redisConfig = registerAs('redis', () => {
  const env = envSchema.parse(process.env);
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    queuePrefix: env.QUEUE_PREFIX,
    workersEnabled: env.QUEUE_WORKERS_ENABLED,
  };
});

export type RedisConfig = ReturnType<typeof redisConfig>;
