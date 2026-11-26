import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { assertSelf } from '../access/access-policy.service.js';
import { AiFeaturesService } from './ai-features.service.js';

const photoBody = z.object({
  fileName: z.string().min(1).max(200),
  /** `data:image/(jpeg|png|webp|gif);base64,...` (≤ ~8 MB). */
  image: z.string().max(12_000_000),
  solve: z.boolean().default(true),
  subjectHint: z.string().max(200).optional(),
});

const generateBody = z.object({
  subjectId: z.string().min(1).max(120),
  chapterId: z.string().min(1).max(160),
  topicId: z.string().max(160).optional(),
  type: z.enum(['mcq', 'short', 'creative']).default('mcq'),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
  count: z.number().int().min(1).max(10).default(5),
  language: z.enum(['bn', 'en', 'mixed']).default('bn'),
});

/** AI features backed by the AI service (AI_PROVIDER=service); 503 AI_NOT_CONFIGURED otherwise. */
@ApiTags('ai')
@ApiBearerAuth()
@Controller()
export class AiFeaturesController {
  constructor(private readonly features: AiFeaturesService) {}

  @Post('evaluations/:studentId/:evaluationId/evaluate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'AI-estimate marks for a handwritten/typed answer (student or reviewer)',
  })
  evaluate(
    @Param('studentId') studentId: string,
    @Param('evaluationId') evaluationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.features.evaluate(user, studentId, evaluationId);
  }

  @Post('ocr/:studentId/solve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Photo solver: read (and optionally solve) a photographed problem' })
  solve(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.features.solvePhoto(studentId, zparse(photoBody, body));
  }

  @Post('questions/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content.create', 'questions.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Draft questions for a chapter (not saved; review then save via /review-items/questions)',
  })
  generate(@Body() body: unknown) {
    return this.features.generateQuestions(zparse(generateBody, body));
  }
}
