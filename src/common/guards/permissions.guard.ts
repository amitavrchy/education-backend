import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAnyPermission, type Permission } from '../auth/permissions.js';
import { PERMISSIONS_KEY } from '../constants/metadata-keys.js';
import type { RequestWithUser } from '../interfaces/authenticated-user.interface.js';

/**
 * Enforces @RequirePermissions(...) (any-of). This is the coarse check; record-level access
 * (whose attempt, which child, which institution) is enforced by AccessPolicyService.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (user && hasAnyPermission(user.permissions, required)) return true;
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'FORBIDDEN' });
  }
}
