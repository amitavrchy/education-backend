import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../constants/metadata-keys.js';
import type { Permission } from '../enums/permission.enum.js';
import type { RequestWithUser } from '../interfaces/authenticated-user.interface.js';

/**
 * Enforces @RequirePermissions(...): the caller needs every listed permission.
 * This is the coarse check; record-level ownership (whose submission, which class)
 * is enforced in services via AccessPolicyService.
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
    if (user && required.every((permission) => user.permissions.includes(permission))) return true;
    throw new ForbiddenException('You do not have permission to perform this action');
  }
}
