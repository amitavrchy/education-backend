export const SPEECH_TO_TEXT_PROVIDER = Symbol('SPEECH_TO_TEXT_PROVIDER');
export const TEXT_TO_SPEECH_PROVIDER = Symbol('TEXT_TO_SPEECH_PROVIDER');

export interface SpeechToTextProvider {
  readonly name: string;
  /** language: BCP-47, e.g. "bn-BD" or "en-US". */
  transcribe(
    audio: Buffer,
    options: { mimeType: string; language?: string },
  ): Promise<{ text: string }>;
}

export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(
    text: string,
    options: { language?: string; voice?: string },
  ): Promise<{ audio: Buffer; mimeType: string }>;
}
