import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/index.js';
import { notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { levelFor } from '../../domain/progress-rules.js';
import { AccessPolicyService, assertSelf } from '../access/access-policy.service.js';
import { ProgressService } from './progress.service.js';

const answer = z
  .object({
    optionId: z.string().max(40).optional(),
    booleanValue: z.boolean().optional(),
    text: z.string().max(20_000).optional(),
    blanks: z.array(z.string().max(500)).max(50).optional(),
    matches: z.record(z.string(), z.string()).optional(),
    numeric: z.number().optional(),
    uploadNames: z.array(z.string().max(200)).max(20).optional(),
  })
  .strict();

const attemptsBody = z.object({
  attempts: z
    .array(
      z.object({
        questionId: z.string().min(1).max(160),
        answer: answer.optional(),
        correct: z.boolean().optional(),
        source: z.enum(['practice', 'exam', 'daily_quiz', 'board_practice', 'flashcard']),
        timeSpentSec: z.number().int().min(0).max(36_000).optional(),
      }),
    )
    .min(1)
    .max(200),
  minutes: z.number().int().min(0).max(600).optional(),
  label: z.string().max(200).optional(),
});

const activityBody = z.object({
  kind: z.enum(['study', 'reading', 'flashcards', 'audio', 'notes', 'voice', 'tutor', 'practice']),
  minutes: z.number().min(0).max(600),
  label: z.string().min(1).max(200),
});

const chapterBody = z.object({
  action: z.union([
    z.enum(['start', 'complete', 'reset']),
    z.object({
      topicDone: z.string().min(1).max(160),
      totalTopics: z.number().int().positive().max(500).optional(),
    }),
  ]),
});

const challengesBody = z.object({
  challenges: z
    .array(
      z.object({
        id: z.string().max(80),
        friend: z.string().max(100),
        title: z.string().max(200),
        status: z.enum(['active', 'won', 'lost', 'pending']),
        myScore: z.number().int().min(0).max(1000),
        theirScore: z.number().int().min(0).max(1000),
      }),
    )
    .max(50),
});

/**
 * Learning-engine endpoints (frontend progressService). Writes are by the student only; reads
 * follow the student-data policy (guardian study-time permission, own institution's teachers).
 */
@ApiTags('progress')
@ApiBearerAuth()
@Controller('progress/:studentId')
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly access: AccessPolicyService,
  ) {}

  @Get('gamification')
  @ApiOperation({ summary: 'XP, level, streak, badges, missions' })
  async gamification(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!(await this.access.canReadStudent(user, studentId, 'studyTime'))) notFound();
    const g = await this.progress.gamification(studentId);
    return { ...g, level: levelFor(g.xp) };
  }

  @Post('attempts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record practice/quiz/flashcard answers (graded server-side when an answer is sent)',
  })
  attempts(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    const dto = zparse(attemptsBody, body);
    return this.progress.recordAttempts(studentId, dto.attempts, {
      minutes: dto.minutes,
      label: dto.label,
    });
  }

  @Post('activity')
  @ApiOperation({ summary: 'Log study time (XP is computed by the server)' })
  activity(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.progress.logActivity(studentId, zparse(activityBody, body));
  }

  @Post('chapters/:chapterId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start / complete / reset a chapter, or mark a topic done' })
  chapter(
    @Param('studentId') studentId: string,
    @Param('chapterId') chapterId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.progress.setChapterStatus(studentId, chapterId, zparse(chapterBody, body).action);
  }

  @Post('missions/:missionId/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim a weekly mission reward (target verified server-side)' })
  claim(
    @Param('studentId') studentId: string,
    @Param('missionId') missionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.progress.claimMission(studentId, missionId);
  }

  @Post('streak-freeze')
  @HttpCode(HttpStatus.OK)
  freeze(@Param('studentId') studentId: string, @CurrentUser() user: AuthenticatedUser) {
    assertSelf(user, studentId);
    return this.progress.useStreakFreeze(studentId);
  }

  @Put('challenges')
  challenges(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.progress.updateChallenges(studentId, zparse(challengesBody, body).challenges);
  }
}
