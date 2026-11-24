import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientContext, CurrentUser, Public } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { AuthService } from './auth.service.js';
import {
  ForgotPasswordDto,
  LoginDto,
  OtpChallengeDto,
  OtpRequestDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  SwitchRoleDto,
  VerifyOtpDto,
} from './dto/auth.dto.js';
import type { SessionContext } from './interfaces/auth.interfaces.js';

/** /api/v1/auth — the flows of the frontend's auth.service.ts. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Password login → AuthSession' })
  login(@Body() dto: LoginDto, @ClientContext() client: SessionContext) {
    return this.auth.loginWithPassword(dto, client);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a login code to a phone/email → PendingOtp' })
  requestOtp(@Body() dto: OtpRequestDto) {
    return this.auth.requestLoginOtp(dto.identifier, dto.remember);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start registration (student/guardian); verify with otp/verify' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a reset code (same answer whether or not the account exists)' })
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.identifier);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  resend(@Body() dto: OtpChallengeDto) {
    return this.auth.resendOtp(dto.challengeId);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a code → { purpose, session? , resetToken? }' })
  verify(@Body() dto: VerifyOtpDto, @ClientContext() client: SessionContext) {
    return this.auth.verifyOtp(dto.challengeId, dto.code, client);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh token → new AuthSession' })
  refresh(@Body() dto: RefreshTokenDto, @ClientContext() client: SessionContext) {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser('sessionId') sessionId?: string) {
    return this.auth.logout(sessionId);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Signed-in user and effective permissions' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user);
  }

  @ApiBearerAuth()
  @Post('onboarded')
  @HttpCode(HttpStatus.OK)
  onboarded(@CurrentUser('id') userId: string) {
    return this.auth.markOnboarded(userId);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('switch-role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demo mode only: sign in as the demo account of a role' })
  switchRole(@Body() dto: SwitchRoleDto, @ClientContext() client: SessionContext) {
    return this.auth.switchRole(dto.role, client);
  }

  @Public()
  @Get('demo-accounts')
  @ApiOperation({ summary: 'Demo mode only: demo accounts for the login quick-picker' })
  demoAccounts() {
    return this.auth.demoAccounts();
  }
}
