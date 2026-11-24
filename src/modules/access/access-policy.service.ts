import { Injectable } from '@nestjs/common';
import { hasAnyPermission } from '../../common/auth/permissions.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import type { GuardianLink } from '../../contracts/people.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { notFound } from '../../common/exceptions/app.exception.js';

/**
 * What kind of student data is being touched. Guardians see an area only when the link's
 * permission flag allows it; AI conversations and private study material stay with the student.
 */
export type StudentArea =
  | 'profile'
  | 'progress'
  | 'scores'
  | 'studyTime'
  | 'calendar'
  | 'teacherFeedback'
  | 'aiConversations'
  | 'private';

type GuardianFlag = keyof GuardianLink['permissions'];

const GUARDIAN_FLAG: Partial<Record<StudentArea, GuardianFlag>> = {
  progress: 'progress',
  scores: 'scores',
  studyTime: 'studyTime',
  calendar: 'calendar',
  teacherFeedback: 'teacherFeedback',
  aiConversations: 'aiConversations',
};

/** Areas institution staff (teachers, school/college admins) may see for their own students. */
const STAFF_AREAS: StudentArea[] = [
  'profile',
  'progress',
  'scores',
  'studyTime',
  'calendar',
  'teacherFeedback',
];

/**
 * Record-level authorization for student-owned data (most users are minors).
 * - Student: their own records.
 * - Guardian: children with an ACTIVE guardian link whose flag allows the area.
 * - Teacher / institution admin: students of their own institution, non-private areas only.
 * - Platform staff: `users.view` or `analytics.view` for non-private areas.
 * Nobody but the student reads private material (notes, flashcards, tutor history unless shared).
 * Callers turn a `false` into a 404 so record existence can't be probed.
 */
@Injectable()
export class AccessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async canReadStudent(
    user: AuthenticatedUser | undefined,
    studentId: string,
    area: StudentArea,
  ): Promise<boolean> {
    if (!user) return false;
    if (user.id === studentId) return true;
    if (area === 'private') return false;

    if (user.permissions.includes('guardian.view')) {
      const link = await this.activeLink(user.id, studentId);
      if (link && (area === 'profile' || this.flagAllows(link, area))) return true;
    }
    if (area === 'aiConversations') return false;

    if (STAFF_AREAS.includes(area)) {
      if (
        hasAnyPermission(user.permissions, ['students.view', 'institution.manage']) &&
        user.institutionId
      ) {
        if ((await this.studentInstitution(studentId)) === user.institutionId) return true;
      }
      if (hasAnyPermission(user.permissions, ['users.view', 'analytics.view'])) return true;
    }
    return false;
  }

  /**
   * Student ids whose data in `area` this caller may list, or 'all'.
   * Used to turn access rules into SQL filters for list endpoints.
   */
  async accessibleStudentIds(
    user: AuthenticatedUser | undefined,
    area: StudentArea,
  ): Promise<'all' | string[]> {
    if (!user) return [];
    const ids = new Set<string>([user.id]);
    if (area === 'private') return [...ids];

    if (user.permissions.includes('guardian.view')) {
      for (const link of await this.links(user.id)) {
        if (link.status === 'active' && (area === 'profile' || this.flagAllows(link, area)))
          ids.add(link.studentId);
      }
    }
    if (area !== 'aiConversations' && STAFF_AREAS.includes(area)) {
      if (hasAnyPermission(user.permissions, ['users.view', 'analytics.view'])) return 'all';
      if (
        hasAnyPermission(user.permissions, ['students.view', 'institution.manage']) &&
        user.institutionId
      ) {
        const rows = await this.prisma.user.findMany({
          where: { institutionId: user.institutionId, role: 'student', deletedAt: null },
          select: { id: true },
        });
        rows.forEach((r) => ids.add(r.id));
      }
    }
    return [...ids];
  }

  async studentInstitution(studentId: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: { institutionId: true },
    });
    return row?.institutionId ?? null;
  }

  private flagAllows(link: GuardianLink, area: StudentArea): boolean {
    const flag = GUARDIAN_FLAG[area];
    return !!flag && link.permissions?.[flag] === true;
  }

  private async activeLink(
    guardianId: string,
    studentId: string,
  ): Promise<GuardianLink | undefined> {
    return (await this.links(guardianId)).find(
      (l) => l.studentId === studentId && l.status === 'active',
    );
  }

  private async links(guardianId: string): Promise<GuardianLink[]> {
    const rows = await this.prisma.record.findMany({
      where: { collection: 'guardianLinks', ownerId: guardianId },
      select: { data: true },
    });
    return rows.map((r) => r.data as unknown as GuardianLink);
  }
}

/** Only the student may perform this action on their own data (others get 404, not 403). */
export function assertSelf(
  user: AuthenticatedUser | undefined,
  studentId: string,
): asserts user is AuthenticatedUser {
  if (!user || user.id !== studentId) notFound();
}
