import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../constants/metadata-keys.js';
import type { RoleKey } from '../enums/role.enum.js';
import type { RequestWithUser } from '../interfaces/authenticated-user.interface.js';

/** Enforces @Roles(...): the caller needs at least one listed role. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleKey[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (user && required.some((role) => user.roles.includes(role))) return true;
    throw new ForbiddenException('Your role does not allow this action');
  }
}
