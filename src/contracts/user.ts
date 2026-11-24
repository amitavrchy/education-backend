// Mirrored from frontend/src/types/user.ts (roles, portals, account status, session shape).
export const USER_ROLES = [
  'student',
  'parent',
  'teacher',
  'content_reviewer',
  'content_manager',
  'school_admin',
  'college_admin',
  'support',
  'platform_admin',
  'super_admin',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PORTALS = ['student', 'parent', 'teacher', 'institution', 'admin'] as const;
export type PortalKey = (typeof PORTALS)[number];

export type AccountStatus = 'active' | 'suspended' | 'pending_deletion' | 'invited';

/** Session user as the frontend's `User` type. */
export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  avatarUrl?: string;
  academicLevel?: string;
  institutionId?: string;
  status?: AccountStatus;
  onboarded?: boolean;
  createdAt: string;
}

export interface AuthSession {
  user: User;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  remember?: boolean;
}
