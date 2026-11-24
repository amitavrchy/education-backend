import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtAccessPayload } from '../../../common/interfaces/authenticated-user.interface.js';
import { jwtConfig, type JwtConfig } from '../../../config/index.js';
import type { TokenSubject } from '../interfaces/auth.interfaces.js';

/** "15m" | "30d" | "12h" | "3600" → milliseconds. */
export function durationMs(value: string): number {
  const m = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!m) throw new Error(`Invalid duration: ${value}`);
  const n = Number(m[1]);
  return (
    n *
    ({ '': 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const)[
      m[2] as '' | 's' | 'm' | 'h' | 'd'
    ]
  );
}

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
      role: subject.role,
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

  accessTtlMs(): number {
    return durationMs(this.config.accessExpiresIn);
  }

  sessionTtlMs(remember: boolean): number {
    return remember
      ? durationMs(this.config.refreshExpiresIn)
      : this.config.sessionTtlHours * 3_600_000;
  }

  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: TokenService.hash(token) };
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
