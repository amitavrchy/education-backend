import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ROLE_PORTAL } from '../../common/auth/permissions.js';
import type { AppNotification } from '../../contracts/operations.js';
import type { PortalKey, UserRole } from '../../contracts/user.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../infrastructure/queues/queue.constants.js';
import type { EmailMessage } from '../../integrations/email/email.module.js';
import { RecordStoreService } from '../records/record-store.service.js';

const NOTIFICATIONS = { collection: 'notifications', scope: '' };

export type NotificationInput = Omit<
  AppNotification,
  'id' | 'read' | 'archived' | 'createdAt' | 'portal'
> & { portal?: PortalKey };

/**
 * In-app notifications (frontend AppNotification + recipient `userId`) and outgoing email.
 * Server-side features push to specific users or fan out to every user of a portal/role.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: RecordStoreService,
    @InjectQueue(QUEUE_NAMES.EMAIL_NOTIFICATIONS) private readonly emailQueue: Queue<EmailMessage>,
  ) {}

  /** Pushes one notification to each user id (best effort: never fails the caller). */
  async push(userIds: string[], input: NotificationInput): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: [...new Set(userIds)] }, deletedAt: null },
        select: { id: true, role: true },
      });
      const now = new Date().toISOString();
      await this.store.insertMany(
        NOTIFICATIONS,
        users.map((u) => ({
          ...input,
          id: RecordStoreService.newId('ntf'),
          userId: u.id,
          portal: input.portal ?? ROLE_PORTAL[u.role as UserRole] ?? 'student',
          read: false,
          archived: false,
          createdAt: now,
        })),
        { ownerField: 'userId' },
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to push notification');
    }
  }

  /** Fans out to every active user whose role maps to `portal` (optionally one institution). */
  async pushToPortal(
    portal: PortalKey,
    input: NotificationInput,
    opts: { institutionId?: string | null; roles?: UserRole[] } = {},
  ): Promise<void> {
    const roles =
      opts.roles ??
      (Object.entries(ROLE_PORTAL)
        .filter(([, p]) => p === portal)
        .map(([r]) => r) as UserRole[]);
    const users = await this.prisma.user.findMany({
      where: {
        role: { in: roles },
        status: 'active',
        deletedAt: null,
        ...(opts.institutionId ? { institutionId: opts.institutionId } : {}),
      },
      select: { id: true },
      take: 5000,
    });
    await this.push(
      users.map((u) => u.id),
      { ...input, portal },
    );
  }

  async markAllRead(userId: string, portal?: string): Promise<number> {
    const rows = await this.store.all(NOTIFICATIONS, [
      { userId: [userId], read: ['false'], ...(portal ? { portal: [portal] } : {}) },
    ]);
    for (const n of rows)
      await this.store.replace(NOTIFICATIONS, { ...n, read: true }, { ownerField: 'userId' });
    return rows.length;
  }

  /** `dedupeKey` (e.g. `welcome:<userId>`) prevents sending the same email twice. */
  async queueEmail(message: EmailMessage, dedupeKey?: string): Promise<void> {
    await this.emailQueue.add('send-email', message, dedupeKey ? { jobId: dedupeKey } : undefined);
  }
}
