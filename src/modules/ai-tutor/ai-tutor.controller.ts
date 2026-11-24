import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { AiTutorService } from './ai-tutor.service.js';
import { TutorChatDto } from './dto/tutor-chat.dto.js';

/** /api/v1/ai/tutor */
@ApiTags('ai')
@Controller('ai/tutor')
export class AiTutorController {
  constructor(private readonly aiTutorService: AiTutorService) {}

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOkResponse({ description: 'Answer with textbook sources' })
  @ApiServiceUnavailableResponse({ description: 'AI provider not configured (AI_PROVIDER=none)' })
  ask(@CurrentUser() user: AuthenticatedUser, @Body() dto: TutorChatDto) {
    return this.aiTutorService.ask(user, dto);
  }
}
