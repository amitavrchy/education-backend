import { ServiceUnavailableException } from '@nestjs/common';
import type {
  ChatCompletionResult,
  ChatModelProvider,
  EmbeddingProvider,
  ImageUnderstandingProvider,
} from '../ai-provider.interfaces.js';

const unavailable = () =>
  new ServiceUnavailableException('AI features are not configured (AI_PROVIDER=none)');

/** Default when AI_PROVIDER=none: the app runs, AI endpoints answer 503. */
export class DisabledAiProvider
  implements ChatModelProvider, EmbeddingProvider, ImageUnderstandingProvider
{
  readonly name = 'none';
  readonly dimensions = 0;

  complete(): Promise<ChatCompletionResult> {
    return Promise.reject(unavailable());
  }

  stream(): AsyncIterable<string> {
    return {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(unavailable()) }),
    };
  }

  embed(): Promise<number[][]> {
    return Promise.reject(unavailable());
  }

  describe(): Promise<{ text: string }> {
    return Promise.reject(unavailable());
  }
}
