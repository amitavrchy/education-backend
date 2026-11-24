import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

/**
 * Single source of truth for environment variables.
 * Validated once at boot: a missing required variable stops the app immediately.
 * Optional integration credentials stay optional so the API starts without them.
 */
export const envSchema = z
  .object({
    // App
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    API_PREFIX: z.string().default('api'),
    API_VERSION: z.string().default('1'),
    FRONTEND_URL: z.url().default('http://localhost:3001'),
    CORS_ORIGINS: csv.default(['http://localhost:3001', 'http://localhost:3000']),
    TRUST_PROXY: booleanString.default(false),
    SWAGGER_ENABLED: booleanString.default(true),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    BODY_SIZE_LIMIT: z.string().default('5mb'),

    // Rate limiting
    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Redis / queues
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: z.coerce.number().int().min(0).default(0),
    QUEUE_PREFIX: z.string().default('shikkhaai'),
    QUEUE_WORKERS_ENABLED: booleanString.default(true),

    // JWT
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
    JWT_ISSUER: z.string().default('shikkhaai-api'),
    JWT_AUDIENCE: z.string().default('shikkhaai-clients'),
    /** Refresh-session lifetime when "remember me" is not ticked. */
    SESSION_TTL_HOURS: z.coerce.number().positive().default(12),

    // Demo mode (never in production): fixed OTP 123456, demo accounts accept any password
    // except "wrongpass", and the role switcher works — exactly what the frontend's demo UI expects.
    AUTH_DEMO_MODE: booleanString.default(false),
    SEED_DEMO_PASSWORD: z.string().min(8).default('demo-password-123'),
    OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

    // File storage
    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    STORAGE_ENDPOINT: z.string().optional(),
    STORAGE_REGION: z.string().default('ap-southeast-1'),
    STORAGE_BUCKET: z.string().default('shikkhaai-dev'),
    STORAGE_ACCESS_KEY: z.string().optional(),
    STORAGE_SECRET_KEY: z.string().optional(),
    UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().positive().default(25),

    // Integrations (all optional; "none"/"console" keeps them disabled)
    AI_PROVIDER: z.enum(['none', 'mock']).default('none'),
    AI_API_KEY: z.string().optional(),
    AI_CHAT_MODEL: z.string().optional(),
    AI_EMBEDDING_MODEL: z.string().optional(),
    EMAIL_PROVIDER: z.enum(['console', 'none']).default('console'),
    EMAIL_FROM: z.string().default('ShikkhaAI <no-reply@shikkha.ai>'),
    SMS_PROVIDER: z.enum(['console', 'none']).default('console'),
    PAYMENT_PROVIDER: z.enum(['none', 'mock']).default('none'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.AUTH_DEMO_MODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_DEMO_MODE'],
        message: 'AUTH_DEMO_MODE must be false in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'PAYMENT_PROVIDER=mock is not allowed in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'Access and refresh secrets must differ in production',
      });
    }
    if (env.STORAGE_PROVIDER === 's3' && (!env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_ACCESS_KEY'],
        message: 'STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required when STORAGE_PROVIDER=s3',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
