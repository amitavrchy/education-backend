import { Permission } from '../../common/enums/permission.enum.js';

/**
 * How a student-owned record may be reached. For each relationship, `true` allows it,
 * a Permission allows it only if the caller holds that permission, and absent denies it.
 */
export interface StudentRecordRule {
  owner?: true | Permission;
  /** Teacher assigned to the student's class (same institution). */
  assigned?: Permission;
  /** Institution admin of the student's institution. */
  institution?: Permission;
  /** Parent with a verified link to the student. */
  children?: true | Permission;
  /** Platform-wide access, granted explicitly (never implied by SUPER_ADMIN). */
  any?: Permission;
}

export const ACCESS_RULES = {
  studentProfile: {
    owner: true,
    assigned: Permission.STUDENTS_READ_ASSIGNED,
    institution: Permission.STUDENTS_READ_INSTITUTION,
    children: true,
    any: Permission.STUDENTS_READ_ANY,
  },
  /** Private exam submissions: no parent access and no platform-wide read permission exists. */
  examSubmission: {
    owner: Permission.SUBMISSIONS_READ_OWN,
    assigned: Permission.SUBMISSIONS_READ_ASSIGNED,
    institution: Permission.SUBMISSIONS_READ_INSTITUTION,
  },
  learningAnalytics: {
    owner: Permission.ANALYTICS_READ_OWN,
    assigned: Permission.ANALYTICS_READ_ASSIGNED,
    institution: Permission.ANALYTICS_READ_INSTITUTION,
    children: Permission.ANALYTICS_READ_CHILDREN,
    any: Permission.ANALYTICS_READ_PLATFORM,
  },
} satisfies Record<string, StudentRecordRule>;
