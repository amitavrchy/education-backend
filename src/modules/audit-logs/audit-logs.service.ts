import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  institutionId?: string | null;
  ipAddress?: string;
  userAgent?: string;
  /** Never put passwords, tokens or full personal records here. */
  metadata?: Prisma.InputJsonValue;
}

/** Append-only audit trail for security-relevant actions. */
@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best effort: an audit failure is logged but never breaks the user's request. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: entry });
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'Failed to write audit log');
    }
  }
}
