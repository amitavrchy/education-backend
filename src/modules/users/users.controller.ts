import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** The signed-in user's own account. Requires only a valid token. */
  @Get('me')
  @ApiOkResponse({ description: 'Own account with roles and profiles' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getOwnProfile(user.id);
  }
}
