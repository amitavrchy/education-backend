import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';

/** Fields safe to return to the account owner. Never select passwordHash here. */
const SELF_PROFILE_SELECT = {
  id: true,
  email: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  createdAt: true,
  roles: { select: { institutionId: true, role: { select: { key: true, name: true } } } },
  studentProfile: { select: { id: true, fullName: true, level: true, institutionId: true } },
  teacherProfile: { select: { id: true, fullName: true, institutionId: true } },
  parentProfile: { select: { id: true, fullName: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwnProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: SELF_PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
