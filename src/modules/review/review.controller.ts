import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { CONTENT_STATUSES } from '../../contracts/common.js';
import type { Question } from '../../contracts/question.js';
import { ReviewService } from './review.service.js';

const transitionBody = z.object({
  to: z.enum(CONTENT_STATUSES),
  note: z.string().max(2000).optional(),
});
const commentBody = z.object({ text: z.string().min(1).max(4000) });
const suggestBody = z.object({
  field: z.string().min(1).max(80),
  from: z.string().max(4000),
  to: z.string().max(4000),
});
const resolveBody = z.object({ accept: z.boolean() });
const questionBody = z.object({
  question: z.looseObject({
    id: z.string().min(1).max(160),
    stem: z.string().min(1).max(20_000),
    answer: z.string().max(20_000),
    explanation: z.string().max(20_000),
    subjectId: z.string().max(120),
    chapterId: z.string().max(160),
    type: z.string().max(40),
    marks: z.number().min(0).max(100),
  }),
  submit: z.boolean().default(false),
});

@ApiTags('review')
@ApiBearerAuth()
@Controller('review-items')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Post('questions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content.create', 'questions.manage')
  @ApiOperation({ summary: 'Teacher authoring: save a question draft (or submit it for review)' })
  saveQuestion(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = zparse(questionBody, body);
    return this.review.saveQuestion(user, dto.question as unknown as Question, dto.submit);
  }

  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(
    'content.create',
    'content.submit',
    'content.review',
    'content.approve',
    'content.publish',
  )
  @ApiOperation({ summary: 'Move an item through the workflow (state machine + role checks)' })
  transition(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const dto = zparse(transitionBody, body);
    return this.review.transition(user, id, dto.to, dto.note);
  }

  @Post(':id/comments')
  @RequirePermissions('content.create', 'content.review', 'content.approve', 'content.publish')
  comment(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.review.comment(user, id, zparse(commentBody, body).text);
  }

  @Post(':id/suggestions')
  @RequirePermissions('content.review', 'content.approve', 'content.publish')
  suggest(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = zparse(suggestBody, body);
    return this.review.suggest(user, id, dto.field, dto.from, dto.to);
  }

  @Post(':id/suggestions/:suggestionId/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content.create', 'content.review', 'content.approve', 'content.publish')
  resolve(
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.review.resolveSuggestion(user, id, suggestionId, zparse(resolveBody, body).accept);
  }
}
