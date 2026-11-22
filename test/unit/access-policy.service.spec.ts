import { NotFoundException } from '@nestjs/common';
import { Permission } from '../../src/common/enums/permission.enum.js';
import { RoleKey } from '../../src/common/enums/role.enum.js';
import type { AuthenticatedUser } from '../../src/common/interfaces/authenticated-user.interface.js';
import type { PrismaService } from '../../src/database/prisma/prisma.service.js';
import { AccessPolicyService } from '../../src/modules/permissions/access-policy.service.js';
import { ACCESS_RULES } from '../../src/modules/permissions/access-rules.js';

const STUDENT_PROFILE_ID = 'student-profile-1';
const student = {
  userId: 'student-user-1',
  institutionId: 'inst-1',
  classId: 'class-10',
  groupId: 'science',
};

function makePrisma(overrides: { assignment?: object | null; parentLink?: object | null } = {}) {
  return {
    studentProfile: { findUnique: vi.fn().mockResolvedValue(student) },
    teacherAssignment: { findFirst: vi.fn().mockResolvedValue(overrides.assignment ?? null) },
    parentStudentLink: { findFirst: vi.fn().mockResolvedValue(overrides.parentLink ?? null) },
  };
}

function user(partial: Partial<AuthenticatedUser>): AuthenticatedUser {
  return { id: 'someone', roles: [], permissions: [], institutionId: null, ...partial };
}

function service(prisma: ReturnType<typeof makePrisma>) {
  return new AccessPolicyService(prisma as unknown as PrismaService);
}

describe('AccessPolicyService — exam submissions', () => {
  const rule = ACCESS_RULES.examSubmission;

  it('lets a student read their own submission', async () => {
    const caller = user({
      id: student.userId,
      roles: [RoleKey.STUDENT],
      permissions: [Permission.SUBMISSIONS_READ_OWN],
    });
    await expect(
      service(makePrisma()).canAccessStudentRecord(caller, STUDENT_PROFILE_ID, rule),
    ).resolves.toBe(true);
  });

  it("blocks a student from another student's submission", async () => {
    const caller = user({
      id: 'other-student',
      roles: [RoleKey.STUDENT],
      permissions: [Permission.SUBMISSIONS_READ_OWN],
    });
    await expect(
      service(makePrisma()).canAccessStudentRecord(caller, STUDENT_PROFILE_ID, rule),
    ).resolves.toBe(false);
  });

  it('lets a teacher assigned to the class read it, and nobody else', async () => {
    const teacher = user({
      id: 'teacher-1',
      roles: [RoleKey.TEACHER],
      permissions: [Permission.SUBMISSIONS_READ_ASSIGNED],
    });
    await expect(
      service(makePrisma({ assignment: { id: 'a1' } })).canAccessStudentRecord(
        teacher,
        STUDENT_PROFILE_ID,
        rule,
      ),
    ).resolves.toBe(true);
    await expect(
      service(makePrisma()).canAccessStudentRecord(teacher, STUDENT_PROFILE_ID, rule),
    ).resolves.toBe(false);
  });

  it('restricts institution admins to their own institution', async () => {
    const own = user({
      roles: [RoleKey.INSTITUTION_ADMIN],
      institutionId: 'inst-1',
      permissions: [Permission.SUBMISSIONS_READ_INSTITUTION],
    });
    const other = { ...own, institutionId: 'inst-2' };
    await expect(
      service(makePrisma()).canAccessStudentRecord(own, STUDENT_PROFILE_ID, rule),
    ).resolves.toBe(true);
    await expect(
      service(makePrisma()).canAccessStudentRecord(other, STUDENT_PROFILE_ID, rule),
    ).resolves.toBe(false);
  });

  it('gives parents no access to private submissions, even when linked', async () => {
    const parent = user({
      id: 'parent-1',
      roles: [RoleKey.PARENT],
      permissions: [Permission.ANALYTICS_READ_CHILDREN],
    });
    await expect(
      service(makePrisma({ parentLink: { id: 'l1' } })).canAccessStudentRecord(
        parent,
        STUDENT_PROFILE_ID,
        rule,
      ),
    ).resolves.toBe(false);
  });

  it('does not let SUPER_ADMIN read submissions implicitly', async () => {
    const admin = user({ roles: [RoleKey.SUPER_ADMIN], permissions: Object.values(Permission) });
    await expect(
      service(makePrisma()).canAccessStudentRecord(admin, STUDENT_PROFILE_ID, rule),
    ).resolves.toBe(false);
  });
});

describe('AccessPolicyService — parents and analytics', () => {
  const rule = ACCESS_RULES.learningAnalytics;

  it('lets a parent with a verified link see their child', async () => {
    const parent = user({
      id: 'parent-1',
      roles: [RoleKey.PARENT],
      permissions: [Permission.ANALYTICS_READ_CHILDREN],
    });
    const prisma = makePrisma({ parentLink: { id: 'l1' } });
    await expect(
      service(prisma).canAccessStudentRecord(parent, STUDENT_PROFILE_ID, rule),
    ).resolves.toBe(true);
    expect(prisma.parentStudentLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ verifiedAt: { not: null } }) }),
    );
  });

  it('denies a parent without a verified link', async () => {
    const parent = user({
      id: 'parent-2',
      roles: [RoleKey.PARENT],
      permissions: [Permission.ANALYTICS_READ_CHILDREN],
    });
    await expect(
      service(makePrisma()).canAccessStudentRecord(parent, STUDENT_PROFILE_ID, rule),
    ).resolves.toBe(false);
  });

  it('surfaces denials as 404 so record existence is not revealed', async () => {
    const stranger = user({ id: 'stranger' });
    await expect(
      service(makePrisma()).assertCanAccessStudentRecord(stranger, STUDENT_PROFILE_ID, rule),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AccessPolicyService — institution boundary', () => {
  it('allows only the caller institution unless granted platform-wide read', () => {
    const policy = service(makePrisma());
    const admin = user({ institutionId: 'inst-1' });
    expect(policy.canAccessInstitution(admin, 'inst-1')).toBe(true);
    expect(policy.canAccessInstitution(admin, 'inst-2')).toBe(false);
    expect(
      policy.canAccessInstitution(
        user({ permissions: [Permission.INSTITUTIONS_READ_ANY] }),
        'inst-2',
      ),
    ).toBe(true);
  });
});
