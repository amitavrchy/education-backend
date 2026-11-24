import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { NOTIFICATION_TYPES, type NotificationType } from '../../contracts/operations.js';
import { PORTALS, type PortalKey } from '../../contracts/user.js';
import { NotificationsService } from './notifications.service.js';

class MarkAllReadDto {
  @IsOptional()
  @IsIn(PORTALS)
  portal?: PortalKey;
}

class BroadcastDto {
  @IsIn(PORTALS)
  portal: PortalKey;

  @IsIn(NOTIFICATION_TYPES)
  type: NotificationType;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(2000)
  body: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  href?: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high'])
  priority?: 'low' | 'normal' | 'high';
}

/** Notification actions beyond the generic /notifications CRUD (which is scoped to the caller). */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark all of the caller's notifications read" })
  async readAll(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkAllReadDto) {
    return { updated: await this.notifications.markAllRead(user.id, dto.portal) };
  }

  @Post('broadcast')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notifications.manage')
  @ApiOperation({ summary: 'Admin broadcast to every user of a portal' })
  async broadcast(@Body() dto: BroadcastDto) {
    await this.notifications.pushToPortal(dto.portal, {
      ...dto,
      priority: dto.priority ?? 'normal',
    });
    return { ok: true };
  }
}
