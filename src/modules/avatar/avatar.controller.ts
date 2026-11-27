import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import { notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import type { BookAvatar } from '../../domain/avatar/book-pages.js';
import { AccessPolicyService, assertSelf } from '../access/access-policy.service.js';
import { AvatarService } from './avatar.service.js';

const id = z.string().min(1).max(160);
const startBody = z.object({ bookId: id });
const askBody = z.object({
  text: z.string().trim().min(1).max(2000),
  inputMode: z.enum(['text', 'voice']).default('text'),
});
const feedbackBody = z.object({ value: z.enum(['up', 'down']) });
const reportBody = z.object({ reason: z.string().trim().min(3).max(300) });
const previewBody = z.object({
  query: z.string().trim().min(1).max(2000),
  avatar: z
    .object({
      id,
      bookId: id,
      name: z.object({ bn: z.string(), en: z.string() }),
      greeting: z.object({ bn: z.string(), en: z.string() }),
      voice: z.object({ language: z.enum(['bn', 'en']) }).passthrough(),
      persona: z.object({
        style: z.enum(['friendly', 'formal', 'socratic']),
        answerLength: z.enum(['short', 'balanced', 'detailed']),
        useExamples: z.boolean(),
      }),
      scopeChapterIds: z.array(z.string()).max(200),
      strictBookScope: z.boolean(),
    })
    .passthrough(),
});

/**
 * Book avatar teacher. Avatars and reports are read through the generic resources
 * (`/book-avatars`, `/avatar-reports`, `/avatar-sessions/:studentId`, `/avatar-messages/:studentId`);
 * everything that answers, counts or reports goes through here.
 */
@ApiTags('avatar')
@ApiBearerAuth()
@Controller('avatar')
export class AvatarController {
  constructor(
    private readonly avatars: AvatarService,
    private readonly access: AccessPolicyService,
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('books.manage', 'kb.manage', 'content.review', 'teacher.dashboard')
  @ApiOperation({ summary: 'Staff: try an (unsaved) avatar; nothing is stored' })
  preview(@Body() body: unknown) {
    const dto = zparse(previewBody, body);
    return this.avatars.preview(dto.avatar as unknown as BookAvatar, dto.query);
  }

  @Post(':studentId/sessions')
  @RequirePermissions('learn')
  @ApiOperation({ summary: 'Start a session with a book avatar (returns the greeting)' })
  start(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.avatars.startSession(studentId, zparse(startBody, body).bookId);
  }

  @Post(':studentId/sessions/:sessionId/messages')
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask the avatar; answered from the book only' })
  ask(
    @Param('studentId') studentId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    const dto = zparse(askBody, body);
    return this.avatars.ask(studentId, sessionId, dto.text, dto.inputMode);
  }

  @Post(':studentId/messages/:messageId/feedback')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  feedback(
    @Param('studentId') studentId: string,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.avatars.feedback(studentId, messageId, zparse(feedbackBody, body).value);
  }

  @Post(':studentId/messages/:messageId/report')
  @RequirePermissions('learn')
  report(
    @Param('studentId') studentId: string,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.avatars.report(studentId, messageId, zparse(reportBody, body).reason);
  }

  @Get(':studentId/usage')
  @ApiOperation({ summary: 'Session counts per book (guardians with the study-time permission)' })
  async usage(@Param('studentId') studentId: string, @CurrentUser() user: AuthenticatedUser) {
    if (!(await this.access.canReadStudent(user, studentId, 'studyTime'))) notFound();
    return this.avatars.usage(studentId);
  }
}
