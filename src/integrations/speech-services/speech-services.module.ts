import { Global, Module, ServiceUnavailableException } from '@nestjs/common';
import {
  SPEECH_TO_TEXT_PROVIDER,
  TEXT_TO_SPEECH_PROVIDER,
  type SpeechToTextProvider,
  type TextToSpeechProvider,
} from './speech.interfaces.js';

class DisabledSpeechProvider implements SpeechToTextProvider, TextToSpeechProvider {
  readonly name = 'none';
  transcribe(): Promise<{ text: string }> {
    return Promise.reject(new ServiceUnavailableException('Speech-to-text is not configured'));
  }
  synthesize(): Promise<{ audio: Buffer; mimeType: string }> {
    return Promise.reject(new ServiceUnavailableException('Text-to-speech is not configured'));
  }
}

/** Speech boundary. Replace the disabled provider with a real adapter when needed. */
@Global()
@Module({
  providers: [
    { provide: SPEECH_TO_TEXT_PROVIDER, useClass: DisabledSpeechProvider },
    { provide: TEXT_TO_SPEECH_PROVIDER, useExisting: SPEECH_TO_TEXT_PROVIDER },
  ],
  exports: [SPEECH_TO_TEXT_PROVIDER, TEXT_TO_SPEECH_PROVIDER],
})
export class SpeechServicesModule {}
