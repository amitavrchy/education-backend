import type { Request } from 'express';
import type { Permission } from '../auth/permissions.js';
import type { UserRole } from '../../contracts/user.js';

/** Claims signed into the access token. Keep it small: no personal data. */
export interface JwtAccessPayload {
  sub: string;
  role: UserRole;
  /** Tenant scope for institution-bound roles. */
  institutionId?: string | null;
  /** Session id, used to revoke tokens with the session. */
  sid?: string;
}

/** The caller, attached to `request.user` by JwtAuthGuard. */
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  /** Resolved per request from the (admin-editable) permission matrix. */
  permissions: Permission[];
  institutionId: string | null;
  sessionId?: string;
  /** Client IP (for audit entries). */
  ip?: string;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}
