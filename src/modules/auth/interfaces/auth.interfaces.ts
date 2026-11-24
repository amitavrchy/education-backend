import type { UserRole } from '../../../contracts/user.js';

/** Everything needed to sign an access token for a user. */
export interface TokenSubject {
  userId: string;
  role: UserRole;
  institutionId: string | null;
  sessionId: string;
}

export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
}

export type OtpPurpose = 'login' | 'register' | 'reset' | 'guardian_link';

/** Returned when a code was sent (frontend PendingOtp + the challenge id to verify against). */
export interface PendingOtp {
  challengeId: string;
  purpose: OtpPurpose;
  target: string;
  remember?: boolean;
  sentAt: string;
  expiresAt: string;
  /** Present only in demo mode, so the UI's "demo code" hint is truthful. */
  demoCode?: string;
}
