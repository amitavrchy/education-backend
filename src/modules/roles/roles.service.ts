import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';

/** Resolves a user's effective roles and permissions (used when issuing tokens). */
@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async getEffectiveAccess(userId: string) {
    const assignments = await this.prisma.userRole.findMany({
      where: { userId },
      select: {
        institutionId: true,
        role: {
          select: { key: true, permissions: { select: { permission: { select: { key: true } } } } },
        },
      },
    });

    const roles = [...new Set(assignments.map((assignment) => assignment.role.key))];
    const permissions = [
      ...new Set(
        assignments.flatMap((assignment) =>
          assignment.role.permissions.map((item) => item.permission.key),
        ),
      ),
    ];
    // A user is bound to at most one institution in v1; multi-institution users come later.
    const institutionId =
      assignments.find((assignment) => assignment.institutionId)?.institutionId ?? null;

    return { roles, permissions, institutionId };
  }
}
