import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { streamChunks } from '../../domain/retrieval.js';
import { assertSelf } from '../access/access-policy.service.js';
import { TutorService } from './tutor.service.js';

const sendBody = z.object({
  content: z.string().trim().min(1).max(4000),
  replaceFromMessageId: z.string().max(160).optional(),
});
const reportBody = z.object({ reason: z.string().min(1).max(300) });
const simulateBody = z.object({
  query: z.string().min(1).max(500),
  subjectId: z.string().max(120).optional(),
  chapterId: z.string().max(160).optional(),
});

/**
 * Tutor endpoints. `POST …/messages` answers JSON `{ user, assistant }`, or a server-sent event
 * stream (meta → citation* → delta* → followups → done) when the client sends
 * `Accept: text/event-stream`. Conversations/folders/feedback use the generic resources.
 */
@ApiTags('tutor')
@ApiBearerAuth()
@Controller()
export class TutorController {
  constructor(private readonly tutor: TutorService) {}

  @Post('tutor/:studentId/conversations/:conversationId/messages')
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiProduces('application/json', 'text/event-stream')
  @ApiOperation({ summary: 'Ask the tutor (JSON or SSE stream)' })
  async send(
    @Param('studentId') studentId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertSelf(user, studentId);
    const dto = zparse(sendBody, body);
    const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');
    if (!wantsStream)
      return this.tutor.send(studentId, conversationId, dto.content, dto.replaceFromMessageId);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const emit = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const { user: userMsg, assistant } = await this.tutor.send(
        studentId,
        conversationId,
        dto.content,
        dto.replaceFromMessageId,
      );
      emit('meta', {
        messageId: assistant.id,
        userMessageId: userMsg?.id,
        mode: assistant.mode,
        grounding: assistant.grounding,
        confidence: assistant.confidence,
        warnings: assistant.warnings,
        simulated: assistant.simulated,
      });
      for (const c of assistant.citations) emit('citation', c);
      for (const text of streamChunks(assistant.content)) emit('delta', { text });
      emit('followups', {
        followUps: assistant.followUps,
        relatedQuestionIds: assistant.relatedQuestionIds,
      });
      emit('done', {
        messageId: assistant.id,
        message: assistant,
        userMessage: userMsg,
        usage: {
          inputTokens: Math.ceil(dto.content.length / 4),
          outputTokens: Math.ceil(assistant.content.length / 4),
        },
      });
    } catch (error) {
      const code = error instanceof AppException ? error.code : 'UPSTREAM_ERROR';
      emit('error', { code, message: code });
    }
    res.end();
    return undefined;
  }

  @Post('tutor/:studentId/messages/:messageId/regenerate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  regenerate(
    @Param('studentId') studentId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.tutor.regenerate(studentId, messageId);
  }

  @Post('tutor/:studentId/messages/:messageId/report')
  @HttpCode(HttpStatus.OK)
  report(
    @Param('studentId') studentId: string,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.tutor.report(studentId, messageId, zparse(reportBody, body).reason);
  }

  @Post('kb/query')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('kb.view', 'kb.manage')
  @ApiOperation({ summary: 'Admin query simulator: what the retriever returns for a question' })
  simulate(@Body() body: unknown) {
    const dto = zparse(simulateBody, body);
    return this.tutor.simulateQuery(dto.query, {
      subjectId: dto.subjectId,
      chapterId: dto.chapterId,
    });
  }
}
