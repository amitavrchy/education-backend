import type { RoleKey } from '../../../common/enums/role.enum.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  tokenType: 'Bearer';
}

/** Everything needed to sign an access token for a user. */
export interface TokenSubject {
  userId: string;
  roles: RoleKey[];
  permissions: string[];
  institutionId: string | null;
  sessionId: string;
}

export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
}
