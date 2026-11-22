/**
 * Vendor-neutral AI capability contracts. Domain modules depend on these tokens only,
 * so a provider (OpenAI, Anthropic, Gemini, a self-hosted model…) can be swapped by
 * writing one adapter class — no domain code changes.
 */

export const CHAT_MODEL_PROVIDER = Symbol('CHAT_MODEL_PROVIDER');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
export const IMAGE_UNDERSTANDING_PROVIDER = Symbol('IMAGE_UNDERSTANDING_PROVIDER');

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Caller id for provider-side abuse monitoring. Never send personal data here. */
  userRef?: string;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: 'stop' | 'length' | 'content_filter' | 'other';
}

export interface ChatModelProvider {
  readonly name: string;
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
  /** Token-by-token streaming for the AI tutor UI. */
  stream(request: ChatCompletionRequest): AsyncIterable<string>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface ImageUnderstandingRequest {
  image: Buffer;
  mimeType: string;
  prompt: string;
}

export interface ImageUnderstandingProvider {
  readonly name: string;
  describe(request: ImageUnderstandingRequest): Promise<{ text: string }>;
}
