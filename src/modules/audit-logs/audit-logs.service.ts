import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import type { AuditLog } from '../../contracts/operations.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { RecordStoreService } from '../records/record-store.service.js';

export interface AuditEntry {
  actor: AuthenticatedUser | { id: string; name?: string; role: string; ip?: string } | null;
  category: AuditLog['category'];
  action: string;
  target: AuditLog['target'];
  /** Never put passwords, tokens or full personal records here. */
  details?: string;
  ip?: string;
}

/**
 * Append-only audit trail in the frontend's AuditLog shape (collection "auditLogs"), so the
 * admin Security & audit screen shows real entries. There is no update/delete path.
 */
@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);
  private readonly names = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /** Best effort: an audit failure is logged but never breaks the user's request. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      const actor = entry.actor
        ? { id: entry.actor.id, name: await this.nameOf(entry.actor), role: entry.actor.role }
        : { id: 'system', name: 'ShikkhaAI', role: 'system' };
      const log: AuditLog = {
        id: RecordStoreService.newId('al'),
        at: new Date().toISOString(),
        actor,
        category: entry.category,
        action: entry.action,
        target: entry.target,
        details: entry.details,
        ip: entry.ip ?? (entry.actor && 'ip' in entry.actor ? (entry.actor.ip ?? '') : ''),
      };
      await this.prisma.record.create({
        data: {
          collection: 'auditLogs',
          scope: '',
          id: log.id,
          data: log as unknown as Prisma.InputJsonValue,
          ownerId: actor.id,
        },
      });
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'Failed to write audit log');
    }
  }

  private async nameOf(actor: NonNullable<AuditEntry['actor']>): Promise<string> {
    if ('name' in actor && actor.name) return actor.name;
    const cached = this.names.get(actor.id);
    if (cached) return cached;
    const row = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { name: true },
    });
    const name = row?.name ?? actor.id;
    this.names.set(actor.id, name);
    return name;
  }
}
