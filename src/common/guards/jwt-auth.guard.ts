import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { jwtConfig, type JwtConfig } from '../../config/index.js';
import { IS_PUBLIC_KEY } from '../constants/metadata-keys.js';
import type {
  JwtAccessPayload,
  RequestWithUser,
} from '../interfaces/authenticated-user.interface.js';

/**
 * Global guard: every route needs a valid Bearer access token unless marked @Public().
 * Verifies signature, expiry, issuer and audience, then attaches request.user.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(jwtConfig.KEY) private readonly config: JwtConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Missing access token');

    let payload: JwtAccessPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtAccessPayload>(token, {
        secret: this.config.accessSecret,
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.user = {
      id: payload.sub,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
      institutionId: payload.institutionId ?? null,
      sessionId: payload.sid,
    };
    return true;
  }

  private extractBearerToken(request: RequestWithUser): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }
}
