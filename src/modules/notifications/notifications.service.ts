import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../infrastructure/queues/queue.constants.js';
import type { EmailMessage } from '../../integrations/email/email.module.js';

/** Outgoing notifications. Email goes through a queue so slow providers never block requests. */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue(QUEUE_NAMES.EMAIL_NOTIFICATIONS) private readonly emailQueue: Queue<EmailMessage>,
  ) {}

  /** `dedupeKey` (e.g. `welcome:<userId>`) prevents sending the same email twice. */
  async queueEmail(message: EmailMessage, dedupeKey?: string): Promise<void> {
    await this.emailQueue.add('send-email', message, dedupeKey ? { jobId: dedupeKey } : undefined);
  }
}
