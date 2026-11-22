import type { Request } from 'express';
import type { RoleKey } from '../enums/role.enum.js';

/** Claims signed into the access token. Keep it small: no personal data. */
export interface JwtAccessPayload {
  sub: string;
  roles: RoleKey[];
  permissions: string[];
  /** Tenant scope for institution-bound roles. */
  institutionId?: string | null;
  /** Session id, used to revoke tokens with the session. */
  sid?: string;
}

/** The caller, attached to `request.user` by JwtAuthGuard. */
export interface AuthenticatedUser {
  id: string;
  roles: RoleKey[];
  permissions: string[];
  institutionId: string | null;
  sessionId?: string;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}
