import { registerAs } from '@nestjs/config';
import { envSchema } from './configuration.js';

export const databaseConfig = registerAs('database', () => {
  const env = envSchema.parse(process.env);
  return {
    url: env.DATABASE_URL,
    logQueries: env.NODE_ENV === 'development' && env.LOG_LEVEL === 'debug',
  };
});

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
