import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatModelProvider,
  EmbeddingProvider,
  ImageUnderstandingProvider,
} from '../ai-provider.interfaces.js';

/**
 * Deterministic, offline provider (AI_PROVIDER=mock) for local development and tests.
 * Lets the frontend exercise AI flows without any paid API.
 */
export class MockAiProvider
  implements ChatModelProvider, EmbeddingProvider, ImageUnderstandingProvider
{
  readonly name = 'mock';
  readonly dimensions = 8;

  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const question = request.messages.findLast((message) => message.role === 'user')?.content ?? '';
    return Promise.resolve({
      content: `[mock] আপনার প্রশ্ন: "${question.slice(0, 120)}"`,
      model: 'mock-model',
      usage: { inputTokens: question.length, outputTokens: 0 },
      finishReason: 'stop',
    });
  }

  async *stream(request: ChatCompletionRequest): AsyncIterable<string> {
    const { content } = await this.complete(request);
    for (const word of content.split(' ')) yield `${word} `;
  }

  embed(texts: string[]): Promise<number[][]> {
    // Cheap stable pseudo-embedding derived from character codes.
    return Promise.resolve(
      texts.map((text) =>
        Array.from(
          { length: this.dimensions },
          (_, i) =>
            ([...text].reduce(
              (sum, char, j) => sum + ((char.charCodeAt(0) * (i + 1) + j) % 97),
              0,
            ) %
              1000) /
            1000,
        ),
      ),
    );
  }

  describe(): Promise<{ text: string }> {
    return Promise.resolve({ text: '[mock] image description' });
  }
}
