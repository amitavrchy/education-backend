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
import { PermissionMatrixService } from '../../modules/access/permission-matrix.service.js';
import { IS_PUBLIC_KEY } from '../constants/metadata-keys.js';
import type {
  JwtAccessPayload,
  RequestWithUser,
} from '../interfaces/authenticated-user.interface.js';

/**
 * Global guard: every route needs a valid Bearer access token unless marked @Public().
 * Verifies signature, expiry, issuer and audience, resolves the caller's permissions from the
 * current matrix and attaches request.user. On public routes a valid token is attached too;
 * an invalid one is ignored.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly matrix: PermissionMatrixService,
    @Inject(jwtConfig.KEY) private readonly config: JwtConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Missing access token');
    }

    let payload: JwtAccessPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtAccessPayload>(token, {
        secret: this.config.accessSecret,
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.user = {
      id: payload.sub,
      role: payload.role,
      permissions: await this.matrix.permissionsFor(payload.role),
      institutionId: payload.institutionId ?? null,
      sessionId: payload.sid,
      ip: request.ip,
    };
    return true;
  }

  private extractBearerToken(request: RequestWithUser): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }
}
