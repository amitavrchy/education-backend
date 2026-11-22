import { registerAs } from '@nestjs/config';
import { envSchema } from './configuration.js';

export const appConfig = registerAs('app', () => {
  const env = envSchema.parse(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    apiVersion: env.API_VERSION,
    frontendUrl: env.FRONTEND_URL,
    corsOrigins: env.CORS_ORIGINS,
    trustProxy: env.TRUST_PROXY,
    swaggerEnabled: env.SWAGGER_ENABLED,
    logLevel: env.LOG_LEVEL,
    bodySizeLimit: env.BODY_SIZE_LIMIT,
    throttle: { ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT },
    uploadMaxFileSizeBytes: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
  };
});

export type AppConfig = ReturnType<typeof appConfig>;
