import { Global, Module } from '@nestjs/common';
import { integrationsConfig, type IntegrationsConfig } from '../../config/index.js';
import {
  CHAT_MODEL_PROVIDER,
  EMBEDDING_PROVIDER,
  IMAGE_UNDERSTANDING_PROVIDER,
} from './ai-provider.interfaces.js';
import { DisabledAiProvider } from './providers/disabled-ai.provider.js';
import { MockAiProvider } from './providers/mock-ai.provider.js';

const AI_ADAPTER = Symbol('AI_ADAPTER');

/**
 * Picks the AI adapter from AI_PROVIDER. Add a real vendor by writing an adapter in
 * ./providers and a case below; API keys come only from AI_API_KEY.
 */
@Global()
@Module({
  providers: [
    {
      provide: AI_ADAPTER,
      inject: [integrationsConfig.KEY],
      useFactory: (config: IntegrationsConfig) =>
        config.ai.provider === 'mock' ? new MockAiProvider() : new DisabledAiProvider(),
    },
    { provide: CHAT_MODEL_PROVIDER, useExisting: AI_ADAPTER },
    { provide: EMBEDDING_PROVIDER, useExisting: AI_ADAPTER },
    { provide: IMAGE_UNDERSTANDING_PROVIDER, useExisting: AI_ADAPTER },
  ],
  exports: [CHAT_MODEL_PROVIDER, EMBEDDING_PROVIDER, IMAGE_UNDERSTANDING_PROVIDER],
})
export class AiProvidersModule {}
