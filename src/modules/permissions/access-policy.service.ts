import { Injectable, NotFoundException } from '@nestjs/common';
import { Permission } from '../../common/enums/permission.enum.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import type { StudentRecordRule } from './access-rules.js';

/**
 * Record-level authorization (ownership + tenancy). Guards answer "may this caller use
 * this endpoint?"; this service answers "may this caller see THIS student's record?".
 *
 * Denials surface as 404 so callers can't probe which records exist.
 */
@Injectable()
export class AccessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async canAccessStudentRecord(
    user: AuthenticatedUser,
    studentProfileId: string,
    rule: StudentRecordRule,
  ): Promise<boolean> {
    const has = (permission: Permission | true | undefined) =>
      permission === true || (permission !== undefined && user.permissions.includes(permission));

    if (rule.any && has(rule.any)) return true;

    const student = await this.prisma.studentProfile.findUnique({
      where: { id: studentProfileId },
      select: { userId: true, institutionId: true, classId: true, groupId: true },
    });
    if (!student) return false;

    if (rule.owner && student.userId === user.id) return has(rule.owner);

    if (
      rule.institution &&
      has(rule.institution) &&
      user.institutionId !== null &&
      student.institutionId === user.institutionId
    ) {
      return true;
    }

    if (rule.assigned && has(rule.assigned) && student.institutionId && student.classId) {
      const assignment = await this.prisma.teacherAssignment.findFirst({
        where: {
          teacher: { userId: user.id },
          institutionId: student.institutionId,
          classId: student.classId,
          OR: [{ groupId: null }, { groupId: student.groupId }],
        },
        select: { id: true },
      });
      if (assignment) return true;
    }

    if (rule.children && has(rule.children)) {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: {
          studentId: studentProfileId,
          parent: { userId: user.id },
          verifiedAt: { not: null },
        },
        select: { id: true },
      });
      if (link) return true;
    }

    return false;
  }

  async assertCanAccessStudentRecord(
    user: AuthenticatedUser,
    studentProfileId: string,
    rule: StudentRecordRule,
  ): Promise<void> {
    if (!(await this.canAccessStudentRecord(user, studentProfileId, rule))) {
      throw new NotFoundException('Record not found');
    }
  }

  /** Tenant boundary: institution-scoped callers may only act inside their own institution. */
  canAccessInstitution(user: AuthenticatedUser, institutionId: string): boolean {
    if (user.permissions.includes(Permission.INSTITUTIONS_READ_ANY)) return true;
    return user.institutionId !== null && user.institutionId === institutionId;
  }

  assertCanAccessInstitution(user: AuthenticatedUser, institutionId: string): void {
    if (!this.canAccessInstitution(user, institutionId))
      throw new NotFoundException('Institution not found');
  }
}
