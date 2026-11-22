import { Inject, Injectable } from '@nestjs/common';
import {
  CHAT_MODEL_PROVIDER,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatModelProvider,
} from '../../../integrations/ai-providers/ai-provider.interfaces.js';
import { TUTOR_SYSTEM_PROMPT } from '../constants/tutor-prompts.js';

/** Plain AI chat: system prompt + conversation → model. Knows nothing about retrieval. */
@Injectable()
export class AiChatService {
  constructor(@Inject(CHAT_MODEL_PROVIDER) private readonly chatModel: ChatModelProvider) {}

  complete(messages: ChatMessage[], userRef: string): Promise<ChatCompletionResult> {
    return this.chatModel.complete({
      messages: [{ role: 'system', content: TUTOR_SYSTEM_PROMPT }, ...messages],
      temperature: 0.3,
      userRef,
    });
  }
}
