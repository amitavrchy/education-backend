import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNotImplementedResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientContext, CurrentUser, Public } from '../../common/decorators/index.js';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto.js';
import type { SessionContext } from './interfaces/auth.interfaces.js';

/** /api/v1/auth — contract is defined; handlers answer 501 until the auth phase. */
@ApiTags('auth')
@ApiNotImplementedResponse({ description: 'Not implemented yet' })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @ClientContext() client: SessionContext) {
    return this.authService.login(dto, client);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @ClientContext() client: SessionContext) {
    return this.authService.refresh(dto, client);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser('sessionId') sessionId?: string) {
    return this.authService.logout(sessionId);
  }
}
