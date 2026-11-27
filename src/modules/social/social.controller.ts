import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { SocialService } from './social.service.js';

const createBody = z.object({ friendId: z.string().min(1).max(120), subjectId: z.string().min(1).max(120) });
const respondBody = z.object({ accept: z.boolean() });
const submitBody = z.object({ answers: z.record(z.string().max(160), z.string().max(40)) });
const scope = z.enum(['class', 'school', 'all']).default('class');

/** Weekly leaderboard and friend challenges (students only; opted-in classmates). */
@ApiTags('social')
@ApiBearerAuth()
@Controller()
@RequirePermissions('learn')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('leaderboard')
  @ApiOperation({ summary: 'Weekly XP leaderboard of my class/school (opted-in students, short names)' })
  leaderboard(@Query('scope') s: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.social.leaderboard(user.id, zparse(scope, s));
  }

  @Get('challenges')
  @ApiOperation({ summary: 'My friend challenges (sent and received)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.social.list(user.id);
  }

  @Get('challenges/classmates')
  @ApiOperation({ summary: 'Classmates I can challenge' })
  classmates(@CurrentUser() user: AuthenticatedUser) {
    return this.social.classmates(user.id);
  }

  @Post('challenges')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Challenge a classmate to a 5-question quiz of a subject' })
  create(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.social.create(user.id, zparse(createBody, body));
  }

  @Post('challenges/:id/respond')
  @HttpCode(HttpStatus.OK)
  respond(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.social.respond(user.id, id, zparse(respondBody, body).accept);
  }

  @Get('challenges/:id/quiz')
  @ApiOperation({ summary: 'The quiz questions (answers only after I have played)' })
  quiz(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.social.quiz(user.id, id);
  }

  @Post('challenges/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.social.submit(user.id, id, zparse(submitBody, body).answers);
  }
}
