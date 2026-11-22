import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { jwtConfig, type JwtConfig } from '../../../config/index.js';
import type { JwtAccessPayload } from '../../../common/interfaces/authenticated-user.interface.js';
import type { TokenSubject } from '../interfaces/auth.interfaces.js';

/**
 * Issues access tokens (short-lived JWT) and opaque refresh tokens.
 * Refresh tokens are random strings; only their SHA-256 hash is stored in user_sessions,
 * which makes rotation and revocation a database operation.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(jwtConfig.KEY) private readonly config: JwtConfig,
  ) {}

  signAccessToken(subject: TokenSubject): Promise<string> {
    const payload: JwtAccessPayload = {
      sub: subject.userId,
      roles: subject.roles,
      permissions: subject.permissions,
      institutionId: subject.institutionId,
      sid: subject.sessionId,
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.accessSecret,
      expiresIn: this.config.accessExpiresIn as never,
      issuer: this.config.issuer,
      audience: this.config.audience,
    });
  }

  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
