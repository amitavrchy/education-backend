import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { AdminService } from './admin.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** The frontend's `sessionRecords` collection, backed by the real refresh sessions. */
  @Get('session-records')
  @RequirePermissions('security.manage', 'users.support')
  @ApiOperation({ summary: 'Active sign-in sessions (SessionRecord[])' })
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.sessions(user);
  }

  @Delete('session-records/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('security.manage', 'users.support')
  @ApiOperation({ summary: 'Revoke a session (signs that device out)' })
  revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.revokeSession(user, id);
  }

  @Get('analytics/series')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Daily platform metrics for the last N days (max 365)' })
  series(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    return this.admin.series(Math.max(1, Math.min(365, days)));
  }

  @Get('analytics/breakdowns')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'MAU, revenue by plan, churn, AI tokens, retention cohorts, subject engagement' })
  breakdowns(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    return this.admin.breakdowns(Math.max(1, Math.min(365, days)));
  }

  @Get('analytics/overview')
  @RequirePermissions('admin.access', 'analytics.view')
  overview() {
    return this.admin.overview();
  }
}
