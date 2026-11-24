import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import { notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { EXAM_KINDS } from '../../contracts/assessment.js';
import { QUESTION_TYPES } from '../../contracts/question.js';
import { AccessPolicyService, assertSelf } from '../access/access-policy.service.js';
import { ExamsService } from './exams.service.js';

const setupBody = z.object({
  kind: z.enum(EXAM_KINDS),
  title: z.string().max(200).optional(),
  subjectId: z.string().max(120).optional(),
  chapterIds: z.array(z.string().max(160)).max(100).default([]),
  topicIds: z.array(z.string().max(160)).max(300).default([]),
  types: z.array(z.enum(QUESTION_TYPES)).max(QUESTION_TYPES.length).default([]),
  count: z.number().int().min(1).max(200),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
  durationMinutes: z.number().int().min(1).max(300),
  negativeMarking: z.number().min(0).max(2).default(0),
  mode: z.enum(['practice', 'exam']).default('exam'),
  randomize: z.boolean().default(true),
  reviewPolicy: z.enum(['immediate', 'after_submit', 'after_publish']).default('after_submit'),
  levelCode: z.enum(['SSC', 'HSC']).optional(),
});

const answer = z.record(
  z.string().max(160),
  z.object({
    optionId: z.string().max(40).optional(),
    booleanValue: z.boolean().optional(),
    text: z.string().max(20_000).optional(),
    blanks: z.array(z.string().max(500)).max(50).optional(),
    matches: z.record(z.string(), z.string()).optional(),
    numeric: z.number().optional(),
    uploadNames: z.array(z.string().max(200)).max(20).optional(),
  }),
);

const saveBody = z.object({
  answers: answer.optional(),
  markedForReview: z.array(z.string().max(160)).max(500).optional(),
  currentIndex: z.number().int().min(0).max(1000).optional(),
  remainingSec: z.number().optional(),
  timePerQuestion: z.record(z.string().max(160), z.number().min(0).max(36_000)).optional(),
});

const submitBody = z.object({
  reason: z.enum(['manual', 'time_expired']).default('manual'),
  answers: answer.optional(),
});

/**
 * Exam attempt lifecycle (frontend examService.createAndStart/startDailyChallenge/start/save/
 * submit/discard). Scoring and time limits are enforced here; catalogue/teacher exams
 * themselves are managed through the generic /exams resource.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller()
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly access: AccessPolicyService,
  ) {}

  @Post('exams/custom')
  @RequirePermissions('learn')
  @ApiOperation({
    summary: 'Create a personal exam from the setup form and start it → { attemptId }',
  })
  async custom(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return { attemptId: await this.exams.createAndStart(user, zparse(setupBody, body)) };
  }

  @Post('exams/daily-challenge')
  @RequirePermissions('learn')
  @ApiOperation({ summary: "Start today's daily challenge → { attemptId }" })
  async daily(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { levelCode } = zparse(
      z.object({ levelCode: z.enum(['SSC', 'HSC']).default('SSC') }),
      body ?? {},
    );
    return { attemptId: await this.exams.startDailyChallenge(user, levelCode) };
  }

  @Post('exams/:examId/attempts')
  @RequirePermissions('learn')
  @ApiOperation({ summary: 'Start or resume an attempt → { attemptId }' })
  async start(@Param('examId') examId: string, @CurrentUser() user: AuthenticatedUser) {
    return { attemptId: await this.exams.start(user, examId) };
  }

  @Get('exam-attempts/:studentId/:attemptId/questions')
  @ApiOperation({ summary: 'Questions of an attempt (answer keys hidden while in progress)' })
  async questions(
    @Param('studentId') studentId: string,
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!(await this.access.canReadStudent(user, studentId, 'scores'))) notFound();
    return this.exams.attemptQuestions(studentId, attemptId);
  }

  @Patch('exam-attempts/:studentId/:attemptId')
  @ApiOperation({ summary: 'Autosave answers (server computes remaining time)' })
  save(
    @Param('studentId') studentId: string,
    @Param('attemptId') attemptId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.exams.save(studentId, attemptId, zparse(saveBody, body));
  }

  @Post('exam-attempts/:studentId/:attemptId/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit and score (server-side)' })
  submit(
    @Param('studentId') studentId: string,
    @Param('attemptId') attemptId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    const dto = zparse(submitBody, body ?? {});
    return this.exams.submit(studentId, attemptId, dto.reason, dto.answers);
  }

  @Delete('exam-attempts/:studentId/:attemptId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard an in-progress attempt' })
  discard(
    @Param('studentId') studentId: string,
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.exams.discard(studentId, attemptId);
  }
}
