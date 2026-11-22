import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_DESCRIPTIONS,
} from '../../common/constants/role-permissions.js';
import { Permission } from '../../common/enums/permission.enum.js';
import { RoleKey } from '../../common/enums/role.enum.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

const ROLE_NAMES: Record<RoleKey, string> = {
  [RoleKey.STUDENT]: 'Student',
  [RoleKey.TEACHER]: 'Teacher',
  [RoleKey.PARENT]: 'Parent',
  [RoleKey.INSTITUTION_ADMIN]: 'Institution Admin',
  [RoleKey.SUPER_ADMIN]: 'Super Admin',
};

/** Idempotent: upserts every permission and role, then resets each role's permission set. */
export async function seedRbac(prisma: PrismaClient): Promise<void> {
  const permissions = await Promise.all(
    Object.values(Permission).map((key) =>
      prisma.permission.upsert({ where: { key }, update: {}, create: { key } }),
    ),
  );
  const permissionIdByKey = new Map(
    permissions.map((permission) => [permission.key, permission.id]),
  );

  for (const roleKey of Object.values(RoleKey)) {
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: { name: ROLE_NAMES[roleKey], description: ROLE_DESCRIPTIONS[roleKey] },
      create: { key: roleKey, name: ROLE_NAMES[roleKey], description: ROLE_DESCRIPTIONS[roleKey] },
    });

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: DEFAULT_ROLE_PERMISSIONS[roleKey].map((key) => ({
          roleId: role.id,
          permissionId: permissionIdByKey.get(key)!,
        })),
      }),
    ]);
  }
}
