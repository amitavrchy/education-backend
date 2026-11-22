import { registerAs } from '@nestjs/config';
import { envSchema } from './configuration.js';

export const storageConfig = registerAs('storage', () => {
  const env = envSchema.parse(process.env);
  return {
    provider: env.STORAGE_PROVIDER,
    localPath: env.STORAGE_LOCAL_PATH,
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    bucket: env.STORAGE_BUCKET,
    accessKey: env.STORAGE_ACCESS_KEY,
    secretKey: env.STORAGE_SECRET_KEY,
  };
});

export const integrationsConfig = registerAs('integrations', () => {
  const env = envSchema.parse(process.env);
  return {
    ai: {
      provider: env.AI_PROVIDER,
      apiKey: env.AI_API_KEY,
      chatModel: env.AI_CHAT_MODEL,
      embeddingModel: env.AI_EMBEDDING_MODEL,
    },
    email: { provider: env.EMAIL_PROVIDER, from: env.EMAIL_FROM },
    sms: { provider: env.SMS_PROVIDER },
    payment: { provider: env.PAYMENT_PROVIDER },
  };
});

export type StorageConfig = ReturnType<typeof storageConfig>;
export type IntegrationsConfig = ReturnType<typeof integrationsConfig>;
