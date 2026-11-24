import type { PortalKey, UserRole } from '../../contracts/user.js';

/**
 * Permission catalogue — mirrors frontend/src/lib/auth/permissions.ts so the UI's client-side
 * guards and the API agree. The effective matrix is admin-editable (document "permissionMatrix",
 * Security → Permission matrix); these are the defaults.
 */
export const PERMISSIONS = [
  'learn',
  'guardian.view',
  'teacher.dashboard',
  'content.create',
  'content.submit',
  'content.review',
  'content.approve',
  'content.publish',
  'rubric.manage',
  'exam.create',
  'assignment.manage',
  'submission.review',
  'evaluation.review',
  'students.view',
  'institution.manage',
  'institution.billing',
  'admin.access',
  'analytics.view',
  'curriculum.manage',
  'books.manage',
  'questions.manage',
  'board.manage',
  'institutionPapers.moderate',
  'exams.manage',
  'coverage.view',
  'kb.view',
  'kb.manage',
  'users.view',
  'users.manage',
  'users.support',
  'teachers.manage',
  'billing.view',
  'billing.manage',
  'moderation.handle',
  'notifications.manage',
  'audit.view',
  'security.manage',
  'roles.manage',
  'system.config',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type PermissionMatrix = Record<UserRole, Permission[]>;

const contentOps: Permission[] = [
  'curriculum.manage',
  'books.manage',
  'questions.manage',
  'board.manage',
  'institutionPapers.moderate',
  'exams.manage',
  'coverage.view',
  'content.review',
  'content.approve',
  'content.publish',
  'kb.view',
];

const allAdmin = PERMISSIONS.filter(
  (p) => !['learn', 'guardian.view', 'institution.manage', 'institution.billing'].includes(p),
);

export const DEFAULT_ROLE_PERMISSIONS: PermissionMatrix = {
  student: ['learn'],
  parent: ['guardian.view'],
  teacher: [
    'teacher.dashboard',
    'content.create',
    'content.submit',
    'exam.create',
    'assignment.manage',
    'submission.review',
    'evaluation.review',
    'students.view',
  ],
  content_reviewer: [
    'teacher.dashboard',
    'content.create',
    'content.review',
    'content.approve',
    'rubric.manage',
    'evaluation.review',
  ],
  content_manager: ['admin.access', ...contentOps, 'analytics.view'],
  school_admin: ['institution.manage', 'institution.billing'],
  college_admin: ['institution.manage', 'institution.billing'],
  support: [
    'admin.access',
    'users.view',
    'users.support',
    'billing.view',
    'moderation.handle',
    'notifications.manage',
  ],
  platform_admin: allAdmin.filter((p) => p !== 'security.manage' && p !== 'roles.manage'),
  super_admin: allAdmin,
};

export const ROLE_PORTAL: Record<UserRole, PortalKey> = {
  student: 'student',
  parent: 'parent',
  teacher: 'teacher',
  content_reviewer: 'teacher',
  content_manager: 'admin',
  school_admin: 'institution',
  college_admin: 'institution',
  support: 'admin',
  platform_admin: 'admin',
  super_admin: 'admin',
};

/** Roles that hold no permission which can ever be removed (prevents admin lock-out). */
export const LOCKED_PERMISSIONS: Partial<Record<UserRole, Permission[]>> = {
  super_admin: ['admin.access', 'roles.manage', 'security.manage'],
};

/** Any-of semantics, exactly like the frontend's hasPermission(). */
export function hasAnyPermission(
  granted: readonly string[],
  needed: readonly Permission[],
): boolean {
  if (!needed.length) return true;
  return needed.some((p) => granted.includes(p));
}
