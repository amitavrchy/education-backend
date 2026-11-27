import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { GuardianService } from './guardian.service.js';

const requestBody = z.object({
  code: z.string().min(4).max(20),
  relation: z.string().min(1).max(40),
});
const confirmBody = z.object({
  challengeId: z.string().length(36),
  code: z.string().min(4).max(8),
});
const replyBody = z.object({ message: z.string().min(1).max(2000) });
const reportBody = z.object({
  studentId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  lines: z.array(z.string().max(1000)).max(60),
});

@ApiTags('guardian')
@ApiBearerAuth()
@Controller('guardian')
export class GuardianController {
  constructor(private readonly guardian: GuardianService) {}

  @Post('link-code')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @ApiOperation({ summary: 'Student: get a code to share with a guardian' })
  linkCode(@CurrentUser('id') studentId: string) {
    return this.guardian.linkCode(studentId);
  }

  @Get('links')
  @RequirePermissions('guardian.view')
  links(@CurrentUser('id') guardianId: string) {
    return this.guardian.links(guardianId);
  }

  @Get('children')
  @RequirePermissions('guardian.view')
  @ApiOperation({ summary: 'Linked children with permission-filtered summaries' })
  children(@CurrentUser('id') guardianId: string) {
    return this.guardian.summaries(guardianId);
  }

  @Post('links')
  @RequirePermissions('guardian.view')
  @ApiOperation({ summary: 'Guardian: enter the student code → pending link + verification code' })
  request(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = zparse(requestBody, body);
    return this.guardian.requestLink(user, dto.code, dto.relation);
  }

  @Post('links/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('guardian.view')
  confirm(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = zparse(confirmBody, body);
    return this.guardian.confirmLink(user, id, dto.challengeId, dto.code);
  }

  @Post('links/:id/unlink')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guardian or student ends a link' })
  unlink(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.guardian.unlink(user, id);
  }

  @Post('feedback/:id/reply')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('guardian.view')
  reply(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.guardian.replyToTeacher(user, id, zparse(replyBody, body).message);
  }

  @Post('report-email')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('guardian.view')
  @ApiOperation({ summary: "Email a child's report to my own address" })
  report(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = zparse(reportBody, body);
    return this.guardian.emailReport(user, dto.studentId, dto.title, dto.lines);
  }
}
