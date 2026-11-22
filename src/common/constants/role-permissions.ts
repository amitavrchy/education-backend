import { Permission as P } from '../enums/permission.enum.js';
import { RoleKey } from '../enums/role.enum.js';

/**
 * Default permission matrix, applied by the seed script.
 * SUPER_ADMIN has no implicit bypass anywhere in the code: it holds an explicit list,
 * so administrative power can be audited and narrowed per deployment.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, readonly P[]> = {
  [RoleKey.STUDENT]: [
    P.CONTENT_READ,
    P.EXAMS_TAKE,
    P.SUBMISSIONS_READ_OWN,
    P.AI_TUTOR_USE,
    P.ANALYTICS_READ_OWN,
    P.UPLOADS_CREATE,
  ],
  [RoleKey.PARENT]: [P.CONTENT_READ, P.ANALYTICS_READ_CHILDREN],
  [RoleKey.TEACHER]: [
    P.CONTENT_READ,
    P.STUDENTS_READ_ASSIGNED,
    P.EXAMS_MANAGE_ASSIGNED,
    P.SUBMISSIONS_READ_ASSIGNED,
    P.SUBMISSIONS_EVALUATE_ASSIGNED,
    P.AI_TUTOR_USE,
    P.AI_QUESTION_GENERATE,
    P.ANALYTICS_READ_ASSIGNED,
    P.UPLOADS_CREATE,
  ],
  [RoleKey.INSTITUTION_ADMIN]: [
    P.CONTENT_READ,
    P.INSTITUTION_MANAGE_OWN,
    P.STUDENTS_READ_INSTITUTION,
    P.STUDENTS_MANAGE_INSTITUTION,
    P.TEACHERS_READ_INSTITUTION,
    P.TEACHERS_MANAGE_INSTITUTION,
    P.SUBMISSIONS_READ_INSTITUTION,
    P.ANALYTICS_READ_INSTITUTION,
    P.UPLOADS_CREATE,
  ],
  [RoleKey.SUPER_ADMIN]: Object.values(P),
};

export const ROLE_DESCRIPTIONS: Record<RoleKey, string> = {
  [RoleKey.STUDENT]: 'SSC / HSC student',
  [RoleKey.TEACHER]: 'Teacher, limited to assigned classes',
  [RoleKey.PARENT]: 'Parent or guardian, limited to verified linked children',
  [RoleKey.INSTITUTION_ADMIN]: 'Administrator of a single school or college',
  [RoleKey.SUPER_ADMIN]: 'Platform administrator with explicitly granted permissions',
};
