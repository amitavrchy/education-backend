import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { UsersService } from './users.service.js';

const ticketBody = z.object({
  category: z.string().trim().min(1).max(40),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
});

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** The signed-in user's own account. Requires only a valid token. */
  @Get('me')
  @ApiOkResponse({ description: 'Own UserAccount record' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getOwnProfile(user.id);
  }

  @Post('me/tickets')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Open a support ticket or send feedback (support is notified)' })
  ticket(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.openTicket(user.id, zparse(ticketBody, body));
  }
}
