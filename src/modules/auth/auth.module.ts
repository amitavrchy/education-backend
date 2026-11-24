import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordHasherService } from './services/password-hasher.service.js';
import { TokenService } from './services/token.service.js';

/**
 * Authentication + the global guard chain. Order matters (global guards run in
 * registration order): authenticate → permissions. The rate-limit guard is registered by
 * RateLimitModule, imported after this module, so it can key on request.user.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordHasherService,
    TokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService, PasswordHasherService, TokenService],
})
export class AuthModule {}
