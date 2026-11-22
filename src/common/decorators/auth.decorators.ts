import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, ROLES_KEY } from '../constants/metadata-keys.js';
import type { Permission } from '../enums/permission.enum.js';
import type { RoleKey } from '../enums/role.enum.js';

/** Opt a route out of authentication. Every other route requires a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Caller must hold at least one of these roles. */
export const Roles = (...roles: RoleKey[]) =>
  applyDecorators(SetMetadata(ROLES_KEY, roles), ApiBearerAuth(), ApiForbiddenResponse());

/** Caller must hold every one of these permissions. Prefer this over @Roles for new code. */
export const RequirePermissions = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    ApiBearerAuth(),
    ApiUnauthorizedResponse(),
    ApiForbiddenResponse(),
  );
