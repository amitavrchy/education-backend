import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Permission } from '../auth/permissions.js';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../constants/metadata-keys.js';

/**
 * Opt a route out of authentication. A valid Bearer token is still read when present,
 * so public routes can tailor answers to a signed-in caller.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Caller must hold AT LEAST ONE of these permissions (any-of, the same semantics as the
 * frontend's hasPermission()). Permissions come from the admin-editable matrix.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    ApiBearerAuth(),
    ApiUnauthorizedResponse(),
    ApiForbiddenResponse(),
  );
