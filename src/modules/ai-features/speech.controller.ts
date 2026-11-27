import { createHash } from 'node:crypto';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { zparse } from '../../common/utils/zod.util.js';
import { AiServiceClient } from '../../integrations/ai-service/ai-service.client.js';

const speechBody = z.object({
  text: z.string().trim().min(1).max(2500),
  language: z.enum(['bn', 'en']).default('bn'),
  voice: z.enum(['female', 'male']).default('female'),
});

type Speech = { mediaType: string; data: string; simulated: boolean };

/** Recent speech by text+voice: the avatar greeting and replayed answers aren't synthesized twice. */
const CACHE_SIZE = 200;

/**
 * Text-to-speech for the apps (book avatar, voice tutor, audio lessons). Browsers and many phones
 * have no Bangla voice, so the audio is made by education-ai (Gemini TTS). Any signed-in user.
 */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('speech')
export class SpeechController {
  private readonly cache = new Map<string, Speech>();

  constructor(private readonly ai: AiServiceClient) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @ApiOperation({ summary: 'Speak a text (WAV, base64) in Bangla or English' })
  async speak(@Body() body: unknown): Promise<Speech> {
    const dto = zparse(speechBody, body);
    const key = createHash('sha256')
      .update(`${dto.voice}|${dto.language}|${dto.text}`)
      .digest('hex');
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const res = await this.ai.tts(dto);
    const speech = { mediaType: res.media_type, data: res.data, simulated: res.simulated };
    if (!res.simulated) {
      this.cache.set(key, speech);
      if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    }
    return speech;
  }
}
