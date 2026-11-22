/**
 * Permission keys (stored in permissions.key), formatted `resource:action[:scope]`.
 * Scope suffixes:
 *   :own         – the caller's own records
 *   :assigned    – records of classes/students assigned to the caller (teachers)
 *   :institution – records inside the caller's institution (institution admins)
 *   :any         – platform-wide (super admins only, granted explicitly)
 */
export enum Permission {
  USERS_READ_ANY = 'users:read:any',
  USERS_MANAGE = 'users:manage',
  ROLES_MANAGE = 'roles:manage',

  STUDENTS_READ_ASSIGNED = 'students:read:assigned',
  STUDENTS_READ_INSTITUTION = 'students:read:institution',
  STUDENTS_READ_ANY = 'students:read:any',
  STUDENTS_MANAGE_INSTITUTION = 'students:manage:institution',

  TEACHERS_READ_INSTITUTION = 'teachers:read:institution',
  TEACHERS_MANAGE_INSTITUTION = 'teachers:manage:institution',

  INSTITUTION_MANAGE_OWN = 'institution:manage:own',
  INSTITUTIONS_READ_ANY = 'institutions:read:any',
  INSTITUTIONS_MANAGE = 'institutions:manage',

  CONTENT_READ = 'content:read',
  CONTENT_MANAGE = 'content:manage',
  CONTENT_REVIEW = 'content:review',

  EXAMS_TAKE = 'exams:take',
  EXAMS_MANAGE_ASSIGNED = 'exams:manage:assigned',
  SUBMISSIONS_READ_OWN = 'submissions:read:own',
  SUBMISSIONS_READ_ASSIGNED = 'submissions:read:assigned',
  SUBMISSIONS_READ_INSTITUTION = 'submissions:read:institution',
  SUBMISSIONS_EVALUATE_ASSIGNED = 'submissions:evaluate:assigned',

  AI_TUTOR_USE = 'ai:tutor:use',
  AI_QUESTION_GENERATE = 'ai:question:generate',
  AI_KNOWLEDGE_MANAGE = 'ai:knowledge:manage',
  AI_MONITOR = 'ai:monitor',

  ANALYTICS_READ_OWN = 'analytics:read:own',
  ANALYTICS_READ_CHILDREN = 'analytics:read:children',
  ANALYTICS_READ_ASSIGNED = 'analytics:read:assigned',
  ANALYTICS_READ_INSTITUTION = 'analytics:read:institution',
  ANALYTICS_READ_PLATFORM = 'analytics:read:platform',

  UPLOADS_CREATE = 'uploads:create',
  SUBSCRIPTIONS_MANAGE = 'subscriptions:manage',
  PAYMENTS_READ_ANY = 'payments:read:any',
  MODERATION_MANAGE = 'moderation:manage',
  AUDIT_LOGS_READ = 'audit-logs:read',
  SETTINGS_MANAGE = 'settings:manage',
}
